import { describe, it, expect } from "vite-plus/test";
import { entityImages, resolveImage, slots } from "../../src/client/images";
import type { Entity } from "../../src/shared/contracts";

const entity = (over: Partial<Entity>): Entity => ({
  id: "tmdb:movie:1",
  kind: "movie",
  version: 0,
  title: "T",
  data: {},
  ...over,
});
const widths = (srcSet?: string) =>
  srcSet?.split(", ").map((part) => Number(part.split(" ")[1]?.slice(0, -1)));

describe("image selection", () => {
  it("labels artwork by what the entity is", () => {
    expect(entityImages(entity({ poster: "/a.jpg", backdrop: "/b.jpg" }))).toEqual([
      { path: "/a.jpg", role: "poster" },
      { path: "/b.jpg", role: "backdrop" },
    ]);
    expect(entityImages(entity({ kind: "person", poster: "/p.jpg" }))[0]?.role).toBe("profile");
    expect(entityImages(entity({ kind: "episode", poster: "/s.jpg" }))[0]?.role).toBe("still");
    expect(entityImages(undefined)).toEqual([]);
  });

  it("never offers more pixels than the slot can show, and never requests original", () => {
    const images = entityImages(entity({ poster: "/a.jpg", backdrop: "/b.jpg" }));
    for (const name of Object.keys(slots) as (keyof typeof slots)[]) {
      const resolved = resolveImage(images, name);
      if (!resolved) continue;
      // A ladder whose smallest rung exceeds the cap still offers that one rung.
      const offered = widths(resolved.srcSet)!;
      expect(offered.length === 1 || Math.max(...offered) <= slots[name].maxWidth).toBe(true);
      expect(resolved.src).not.toContain("/original/");
    }
  });

  it("matches artwork to the slot's shape and falls back in preference order", () => {
    const both = entityImages(entity({ poster: "/a.jpg", backdrop: "/b.jpg" }));
    expect(resolveImage(both, "card")?.src).toContain("/a.jpg");
    expect(resolveImage(both, "backdrop")?.src).toContain("/b.jpg");
    const backdropOnly = entityImages(entity({ backdrop: "/b.jpg" }));
    expect(resolveImage(backdropOnly, "feed")?.src).toContain("/b.jpg");
    expect(resolveImage(backdropOnly, "card")).toBeUndefined();
    const posterOnly = entityImages(entity({ poster: "/a.jpg" }));
    expect(resolveImage(posterOnly, "backdrop")).toBeUndefined();
  });

  it("uses the size ladder of the artwork's role", () => {
    const person = entityImages(entity({ kind: "person", poster: "/p.jpg" }));
    expect(resolveImage(person, "thumb")?.srcSet).toContain("/w185/p.jpg 185w");
    const still = entityImages(entity({ kind: "episode", poster: "/s.jpg" }));
    expect(resolveImage(still, "still")?.srcSet).toContain("/w185/s.jpg 185w");
  });

  it("passes absolute URLs through untouched", () => {
    expect(resolveImage([{ path: "https://x.test/me.png", role: "poster" }], "avatar")).toEqual({
      src: "https://x.test/me.png",
    });
  });
});
