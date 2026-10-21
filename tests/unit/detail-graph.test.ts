import { describe, expect, it } from "vite-plus/test";
import { detailTargets, mergeEntity, viewportGraph } from "../../src/shared/detail-graph";
import { normalize, summarize } from "../../src/server/entity-store/normalize";
import { movieDetail } from "../fixtures/catalog";

const graph = normalize("tmdb:movie:550", movieDetail, 3);
const full = graph.find((entity) => entity.id === "tmdb:movie:550")!;
const preview = viewportGraph(graph, full.id).find((entity) => entity.id === full.id)!;
describe("bounded first-screen graphs", () => {
  it("selects the same visible credits and related titles for data and artwork", () => {
    const byId = new Map(graph.map((entity) => [entity.id, entity]));
    expect(detailTargets(full, (id) => byId.get(id))).toMatchObject({
      people: ["tmdb:person:819", "tmdb:person:7467"],
      titles: ["tmdb:movie:680"],
    });
  });
  it("limits prolific neighbours while keeping the full graph and source untouched", () => {
    const entities = normalize(
      "tmdb:person:9",
      {
        id: 9,
        name: "An actor",
        combined_credits: {
          cast: Array.from({ length: 300 }, (_, i) => ({
            id: i + 1,
            title: `Story ${i}`,
            media_type: "movie",
            credit_id: `role-${i}`,
          })),
        },
      },
      7,
    );
    const visible = viewportGraph(entities, "tmdb:person:9");
    expect(visible.filter((entity) => entity.kind === "movie")).toHaveLength(24);
    expect(visible.filter((entity) => entity.kind === "credit")).toHaveLength(24);
    expect(visible).toHaveLength(49);
    expect(entities.filter((entity) => entity.kind === "movie")).toHaveLength(300);
    expect(visible.at(-1)?.data.graphScope).toBe("viewport");
  });
  it("upgrades a neighbour preview to the full graph at the same source version", () => {
    expect(mergeEntity(preview, full, 3)).toBe(full);
    expect(mergeEntity(full, preview, 3)).toBeUndefined();
    expect(mergeEntity(full, full, 3)).toBeUndefined();
    expect(mergeEntity(preview, preview, 3)).toBeUndefined();
  });
  it("does not let an old preview or embedded summary erase newer full details", () => {
    expect(mergeEntity(full, { ...preview, version: 2 }, 3)).toBeUndefined();
    expect(mergeEntity(full, summarize(full), 3)).toBeUndefined();
  });
  it("accepts the full new graph after its summary event arrives first", () => {
    const newer = normalize("tmdb:movie:550", { ...movieDetail, title: "Updated" }, 4).find(
      (entity) => entity.id === full.id,
    )!;
    const announced = mergeEntity(full, summarize(newer), 3)!;
    expect(announced.version).toBe(4);
    expect(announced.data.graphVersion).toBe(3);
    expect(mergeEntity(announced, newer, 4)).toBe(newer);
  });
  it("allows a newer partial projection to replace stale relations and upgrade later", () => {
    const newer = { ...preview, version: 4, data: { ...preview.data, graphVersion: 4 } };
    expect(mergeEntity(full, newer, 3)).toBe(newer);
    expect(
      mergeEntity(newer, { ...full, version: 4, data: { ...full.data, graphVersion: 4 } }, 4),
    ).toMatchObject({ version: 4, data: { graphVersion: 4 } });
  });
});
