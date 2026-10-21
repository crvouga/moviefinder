import type { Entity } from "../shared/contracts";
import { detailTargets } from "../shared/detail-graph";
import { entityImages, prepareImage, type SlotName } from "./images";

// Start from response data, before collection commits/live queries, and from cached data while
// HTTP is still in flight. Images share the existing decoded-image cache and cancellation.
export function prepareGraphArtwork(
  entities: Entity[],
  roots: string[],
  cached: (id: string) => Entity | undefined,
  signal?: AbortSignal,
  priority = false,
) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const get = (id: string) => byId.get(id) ?? cached(id);
  const work = new Map<string, [Entity, SlotName]>();
  const add = (id: string, slot: SlotName) => {
    const entity = get(id);
    if (entity && work.size < 24) work.set(`${id}:${slot}`, [entity, slot]);
  };
  for (const id of roots) {
    add(id, "hero");
    add(id, "backdrop");
  }
  roots.slice(0, 1).forEach((id) => {
    const root = get(id);
    if (!root) return;
    const targets = detailTargets(root, get);
    for (const person of targets.people) add(person, "thumb");
    for (const title of targets.titles) add(title, "card");
    for (const season of targets.seasons) add(season, "thumb");
    for (const episode of targets.episodes) add(episode, "still");
  });
  return Promise.all(
    [...work.values()].map(([entity, slot]) =>
      prepareImage(entityImages(entity), slot, signal, priority),
    ),
  );
}
