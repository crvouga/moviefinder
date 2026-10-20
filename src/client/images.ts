import type { Entity } from "../shared/contracts";

// One place decides which image to fetch and at what resolution. Screens pass every image an
// entity has plus the slot it will occupy; `resolveImage` picks the source whose shape fits and
// a srcset that never offers more pixels than the slot can show. Nothing else builds TMDB URLs.

const TMDB_IMAGES = "https://image.tmdb.org/t/p";

export type ImageRole = "poster" | "profile" | "still" | "backdrop";
export type ImageShape = "portrait" | "landscape";
export type ImageSource = { path: string; role: ImageRole };

// TMDB serves a fixed ladder per role. `dir` is the path segment; `width` is the rendered pixel
// width used in the srcset descriptor (profile `h632` is height-based, 2:3 makes it 421 wide).
const ladders: Record<ImageRole, readonly { dir: string; width: number }[]> = {
  poster: [
    { dir: "w92", width: 92 },
    { dir: "w154", width: 154 },
    { dir: "w185", width: 185 },
    { dir: "w342", width: 342 },
    { dir: "w500", width: 500 },
    { dir: "w780", width: 780 },
  ],
  profile: [
    { dir: "w45", width: 45 },
    { dir: "w185", width: 185 },
    { dir: "h632", width: 421 },
  ],
  still: [
    { dir: "w92", width: 92 },
    { dir: "w185", width: 185 },
    { dir: "w300", width: 300 },
  ],
  backdrop: [
    { dir: "w300", width: 300 },
    { dir: "w780", width: 780 },
    { dir: "w1280", width: 1280 },
  ],
};

const shapes: Record<ImageRole, ImageShape> = {
  poster: "portrait",
  profile: "portrait",
  still: "landscape",
  backdrop: "landscape",
};

// A slot is a place on screen. `sizes` is the CSS width the image is laid out at, `maxWidth` the
// most device pixels worth downloading for it, `shapes` the acceptable artwork in preference order.
export type ImageSlot = {
  shapes: readonly ImageShape[];
  sizes: string;
  maxWidth: number;
};

export const slots = {
  /** Full-bleed discovery slide. */
  feed: {
    shapes: ["portrait", "landscape"],
    sizes: "(max-width: 480px) 100vw, 440px",
    maxWidth: 780,
  },
  /** Grid and search results. */
  card: { shapes: ["portrait"], sizes: "(max-width: 700px) 34vw, 200px", maxWidth: 342 },
  /** Detail page lead artwork. */
  hero: { shapes: ["portrait"], sizes: "(max-width: 700px) 100px, 235px", maxWidth: 500 },
  /** Small portrait beside text: cast, seasons, list entries, stacked list covers. */
  thumb: { shapes: ["portrait"], sizes: "110px", maxWidth: 185 },
  /** Episode stills. */
  still: { shapes: ["landscape"], sizes: "(max-width: 700px) 65px, 100px", maxWidth: 185 },
  /** Atmospheric wash behind a detail page; dimmed, so resolution is wasted on it. */
  backdrop: { shapes: ["landscape"], sizes: "100vw", maxWidth: 780 },
  /** Account photo. */
  avatar: { shapes: ["portrait", "landscape"], sizes: "110px", maxWidth: 185 },
} as const satisfies Record<string, ImageSlot>;
export type SlotName = keyof typeof slots;

const external = (path: string) => path.startsWith("https://");
const url = (dir: string, path: string) => `${TMDB_IMAGES}/${dir}${path}`;

// Person artwork is a profile, an episode's is a still; everything else is a poster. The entity
// stores one `poster` field for all three, so its kind says what it is.
export function entityImages(entity: Entity | undefined): ImageSource[] {
  if (!entity) return [];
  const role: ImageRole =
    entity.kind === "person" ? "profile" : entity.kind === "episode" ? "still" : "poster";
  const images: ImageSource[] = [];
  if (entity.poster) images.push({ path: entity.poster, role });
  if (entity.backdrop) images.push({ path: entity.backdrop, role: "backdrop" });
  return images;
}

export type ResolvedImage = { src: string; srcSet?: string; sizes?: string };

export function pickSource(images: readonly ImageSource[], slot: ImageSlot) {
  for (const shape of slot.shapes) {
    const match = images.find((image) => shapes[image.role] === shape);
    if (match) return match;
  }
}

export function resolveImage(
  images: readonly ImageSource[],
  slot: ImageSlot | SlotName,
): ResolvedImage | undefined {
  const target = typeof slot === "string" ? slots[slot] : slot;
  const source = pickSource(images, target);
  if (!source) return;
  // Account photos and other absolute URLs are not ours to resize.
  if (external(source.path)) return { src: source.path };
  const ladder = ladders[source.role];
  const allowed = ladder.filter((rung) => rung.width <= target.maxWidth);
  const rungs = allowed.length ? allowed : ladder.slice(0, 1);
  const largest = rungs[rungs.length - 1]!;
  return {
    src: url(largest.dir, source.path),
    srcSet: rungs.map((rung) => `${url(rung.dir, source.path)} ${rung.width}w`).join(", "),
    sizes: target.sizes,
  };
}

// Starts the same request the matching <Image> will make, so the browser cache answers it.
export function warmImage(
  images: readonly ImageSource[],
  slot: ImageSlot | SlotName,
): (() => void) | undefined {
  const resolved = resolveImage(images, slot);
  if (!resolved) return;
  const image = new Image();
  image.fetchPriority = "low";
  if (resolved.srcSet) {
    image.sizes = resolved.sizes ?? "";
    image.srcset = resolved.srcSet;
  }
  image.src = resolved.src;
  return () => {
    image.removeAttribute("srcset");
    image.removeAttribute("src");
  };
}
