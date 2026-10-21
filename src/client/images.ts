import { track, contextFor, telemetryEnabled } from "./telemetry";
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

// Decoded artwork is shared by predictions and navigation; no entity data lives here.
type PreparedImage = {
  image: HTMLImageElement;
  trace?: ReturnType<typeof contextFor>;
  promise: Promise<void>;
  consumers: number;
  settled: boolean;
  failed: boolean;
  expires: number;
  cancel: () => void;
};
const prepared = new Map<string, PreparedImage>();
const imageKey = (image: ResolvedImage) =>
  `${image.src}|${image.srcSet ?? ""}|${image.sizes ?? ""}`;
export function imageUnavailable(image: ResolvedImage) {
  const entry = prepared.get(imageKey(image));
  return !!entry?.failed && entry.expires > Date.now();
}
export function prepareImage(
  images: readonly ImageSource[],
  slot: ImageSlot | SlotName,
  signal?: AbortSignal,
  priority = false,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const began = performance.now();
  const context = contextFor(signal);
  const resolved = resolveImage(images, slot);
  if (!resolved) return Promise.resolve();
  const key = imageKey(resolved);
  let entry = prepared.get(key);
  track("image", "interest", {
    ...context,
    cacheHit: !!entry?.settled && entry.expires > Date.now(),
    foreground: priority,
  });
  if (entry?.settled && entry.expires <= Date.now()) {
    prepared.delete(key);
    entry = undefined;
  }
  if (!entry) {
    for (const [heldKey, held] of prepared)
      if (held.settled && !held.consumers && (held.expires <= Date.now() || prepared.size >= 128))
        prepared.delete(heldKey);
    const image = new Image();
    const imageTrace = telemetryEnabled ? { traceId: crypto.randomUUID() } : undefined;
    let downloaded: number | undefined;
    let outcome = "failed";
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const current: PreparedImage = {
      image,
      trace: imageTrace,
      promise,
      consumers: 0,
      settled: false,
      failed: false,
      expires: Infinity,
      cancel: () => {
        image.removeAttribute("srcset");
        image.removeAttribute("src");
        settle(true);
      },
    };
    const settle = (failed: boolean) => {
      if (current.settled) return;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      current.settled = true;
      current.failed = failed;
      current.expires = Date.now() + (failed ? 30_000 : 60_000);
      track("image", "prepare", {
        ...imageTrace,
        ms: performance.now() - began,
        downloadMs: downloaded ? downloaded - began : undefined,
        decodeMs: downloaded ? performance.now() - downloaded : undefined,
        outcome: failed ? outcome : "success",
      });
      finish();
    };
    // Failed or stalled artwork gets the normal static fallback at the destination.
    const timeout = setTimeout(() => {
      outcome = "timeout";
      current.cancel();
    }, 3000);
    image.onload = () => {
      downloaded = performance.now();
      void image.decode().then(
        () => settle(false),
        () => settle(true),
      );
    };
    image.onerror = () => settle(true);
    image.fetchPriority = priority ? "high" : "low";
    if (resolved.srcSet) {
      image.sizes = resolved.sizes ?? "";
      image.srcset = resolved.srcSet;
    }
    image.src = resolved.src;
    prepared.set(key, current);
    entry = current;
  }
  const current = entry;
  if (priority) current.image.fetchPriority = "high";
  current.consumers++;
  return new Promise<void>((resolve, reject) => {
    const release = () => {
      signal?.removeEventListener("abort", abort);
      current.consumers--;
      if (!current.settled && !current.consumers) {
        prepared.delete(key);
        track("image", "cancel", {
          ...context,
          workId: current.trace?.traceId,
          ms: performance.now() - began,
        });
        current.cancel();
      }
    };
    const abort = () => {
      release();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then(() => {
      if (signal?.aborted) return;
      release();
      track("image", "wait", {
        ...context,
        workId: current.trace?.traceId,
        ms: performance.now() - began,
        foreground: priority,
        failed: current.failed,
      });
      resolve();
    });
  });
}
export function warmImage(images: readonly ImageSource[], slot: ImageSlot | SlotName) {
  const controller = new AbortController();
  void prepareImage(images, slot, controller.signal).catch(() => {});
  return () => controller.abort();
}
