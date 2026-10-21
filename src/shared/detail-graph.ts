import type { Entity } from "./contracts";

export const entityIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

// The same bounded first-screen interest drives server graph inclusion and browser artwork.
export function detailTargets(root: Entity, get: (id: string) => Entity | undefined) {
  const relations = (root.data.relations ?? {}) as Record<string, unknown>;
  return {
    people: [
      ...new Set(
        entityIds(root.data.credits)
          .slice(0, 8)
          .map((id) => get(id)?.data.personId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ],
    titles: [
      ...new Set([
        ...entityIds(relations.filmography),
        ...entityIds(relations.recommendations),
        ...entityIds(relations.similar),
        ...entityIds(relations.knownFor),
      ]),
    ].slice(0, 8),
    seasons: entityIds(root.data.seasons).slice(0, 4),
    episodes: entityIds(root.data.episodes).slice(0, 4),
  };
}

// Include enough of a cached neighbour for its first screen, without recursively expanding
// its neighbours or transmitting a prolific person's entire career on every movie read.
export function viewportGraph(entities: Entity[], id: string): Entity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const root = byId.get(id);
  if (!root) return [];
  const relations = Object.fromEntries(
    Object.entries((root.data.relations ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      entityIds(value).slice(0, key === "filmography" ? 24 : 8),
    ]),
  );
  const titles = new Set(Object.values(relations).flat());
  const credits = entityIds(root.data.credits).slice(0, 8);
  const filmographyCredits = entityIds(root.data.filmographyCredits)
    .filter((key) => titles.has(String(byId.get(key)?.data.titleId)))
    .slice(0, 72);
  const seasons = entityIds(root.data.seasons).slice(0, 4);
  const episodes = entityIds(root.data.episodes).slice(0, 4);
  const wanted = new Set([
    ...(root.genres ?? []),
    ...titles,
    ...credits,
    ...filmographyCredits,
    ...seasons,
    ...episodes,
  ]);
  for (const key of [...credits, ...filmographyCredits]) {
    const credit = byId.get(key);
    if (typeof credit?.data.personId === "string") wanted.add(credit.data.personId);
  }
  wanted.delete(id);
  const data = { ...root.data };
  // Full provider filter memberships can contain thousands of IDs; they aren't viewport data.
  delete data.castIds;
  delete data.crewIds;
  return [
    ...[...wanted].flatMap((key) => (byId.get(key) ? [byId.get(key)!] : [])),
    {
      ...root,
      related: [...credits, ...seasons, ...episodes, ...titles],
      data: {
        ...data,
        graphScope: "viewport",
        credits,
        filmographyCredits,
        seasons,
        episodes,
        relations,
      },
    },
  ];
}

// Versions belong to source documents; scope distinguishes projections of the same version.
// Repeated full reads and neighbour previews must not tear down an already complete graph.
export function mergeEntity(
  held: Entity | undefined,
  incoming: Entity,
  known = -1,
): Entity | undefined {
  if (incoming.version < known) return;
  const summary = incoming.data.summary === true;
  if (held && incoming.version === known) {
    if (summary) return;
    const full =
      held.data.summary !== true &&
      held.data.graphScope !== "viewport" &&
      held.data.graphVersion === incoming.version;
    if (full && incoming.data.graphScope === "viewport") return;
    if (
      incoming.version > 0 &&
      held.data.graphVersion === incoming.version &&
      held.data.summary !== true &&
      held.data.graphScope === incoming.data.graphScope
    )
      return;
  }
  return summary && held
    ? {
        ...incoming,
        related: held.related,
        data: { ...held.data, ...incoming.data, summary: held.data.summary },
      }
    : incoming;
}
