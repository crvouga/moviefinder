import { describe, expect, it } from "vite-plus/test";
import { normalize, summarize, summaryOf } from "../../src/server/entity-store/normalize";

const series = {
  id: 549,
  name: "A very long running series",
  first_air_date: "1990-09-13",
  vote_average: 7.4,
  vote_count: 1200,
  genres: [{ id: 18, name: "Drama" }],
  aggregate_credits: {
    cast: Array.from({ length: 5000 }, (_, i) => ({ id: 10000 + i, name: `Actor ${i}`, order: i })),
    crew: Array.from({ length: 4000 }, (_, i) => ({
      id: 50000 + i,
      name: `Crew ${i}`,
      department: i === 3999 ? "Directing" : "Sound",
    })),
  },
  recommendations: {
    results: [{ id: 1, name: "Another", media_type: "tv", first_air_date: "2000-01-01" }],
  },
};
describe("client projections", () => {
  it("bounds the detail graph of a series with thousands of credits", () => {
    const entities = normalize("tmdb:tv:549", series, 3);
    expect(entities.length).toBeLessThan(500);
    const primary = entities.find((e) => e.id === "tmdb:tv:549")!;
    // Filters keep matching people beyond the displayed cast.
    expect((primary.data.castIds as number[]).length).toBe(5000);
    // The displayed crew favors the people who shaped the series.
    expect(entities.some((e) => e.kind === "person" && e.title === "Crew 3999")).toBe(true);
  });
  it("caps a prolific filmography by popularity", () => {
    const cast = Array.from({ length: 800 }, (_, i) => ({
      id: i + 1,
      title: `Film ${i}`,
      media_type: "movie",
      popularity: i,
      credit_id: `c${i}`,
    }));
    const entities = normalize(
      "tmdb:person:9",
      { id: 9, name: "Prolific", combined_credits: { cast } },
      1,
    );
    const primary = entities.find((e) => e.id === "tmdb:person:9")!;
    const filmography = (primary.data.relations as Record<string, string[]>).filmography!;
    expect(filmography).toHaveLength(300);
    expect(filmography[0]).toBe("tmdb:movie:800");
  });
  it("summarizes a title to its scalar fields alone", () => {
    const [summary] = summaryOf("tmdb:tv:549", series, 3);
    expect(summary).toMatchObject({
      id: "tmdb:tv:549",
      version: 3,
      title: "A very long running series",
    });
    expect(summary!.related).toBeUndefined();
    expect(summary!.data.summary).toBe(true);
    expect(summary!.data.releaseDate).toBe("1990-09-13");
    for (const value of Object.values(summary!.data))
      expect(typeof value === "object" && value !== null).toBe(false);
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
    expect(
      summarize(normalize("tmdb:tv:549", series, 3).find((e) => e.id === "tmdb:tv:549")!),
    ).toEqual(summary);
  });
});
