import { z } from "zod";
export const kinds = [
  "movie",
  "tv",
  "season",
  "episode",
  "person",
  "credit",
  "genre",
  "user",
  "status",
  "list",
  "item",
  "collaborator",
  "activity",
  "feed",
  "follow",
  "invitation",
  "query",
] as const;
export type Kind = (typeof kinds)[number];
export type Entity = {
  id: string;
  kind: Kind;
  version: number;
  title: string;
  name?: string;
  overview?: string;
  poster?: string | null;
  backdrop?: string | null;
  year?: number;
  rating?: number;
  popularity?: number;
  genres?: string[];
  related?: string[];
  data: Record<string, unknown>;
};
export const canonicalId = (type: string, id: string | number) => `tmdb:${type}:${id}`;
export const sourceId = z
  .string()
  .regex(/^tmdb:(movie|tv|person):\d+(?::season:\d+(?::episode:\d+)?)?$/);
export const titleId = z.string().regex(/^tmdb:(movie|tv):\d+$/);
const csvNumbers = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").filter(Boolean).map(Number) : v),
  z
    .array(z.number().int().positive())
    .max(30)
    .default([])
    .transform((values) => [...new Set(values)].sort((a, b) => a - b)),
);
const optionalNumber = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().finite().optional(),
);
const optionalText = (schema: z.ZodType<string>) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
export const feedParams = z
  .object({
    type: z.enum(["movie", "tv", "both"]).default("both"),
    sort: z
      .enum([
        "popularity",
        "rating",
        "lowest",
        "newest",
        "oldest",
        "trending",
        "random",
        "relevance",
      ])
      .default("popularity"),
    genres: csvNumbers,
    excludeGenres: csvNumbers,
    yearMin: optionalNumber.pipe(z.number().int().min(0).max(3000).optional()),
    yearMax: optionalNumber.pipe(z.number().int().min(0).max(3000).optional()),
    dateMin: optionalText(z.iso.date()),
    dateMax: optionalText(z.iso.date()),
    runtimeMin: optionalNumber.pipe(z.number().nonnegative().optional()),
    runtimeMax: optionalNumber.pipe(z.number().nonnegative().optional()),
    language: optionalText(z.string().regex(/^[a-z]{2}$/)),
    country: optionalText(z.string().regex(/^[A-Z]{2}$/)),
    ratingMin: optionalNumber.pipe(z.number().min(0).max(10).optional()),
    ratingMax: optionalNumber.pipe(z.number().min(0).max(10).optional()),
    votesMin: optionalNumber.pipe(z.number().int().nonnegative().optional()),
    popularityMin: optionalNumber.pipe(z.number().nonnegative().optional()),
    popularityMax: optionalNumber.pipe(z.number().nonnegative().optional()),
    cast: csvNumbers,
    crew: csvNumbers,
    keywords: csvNumbers,
    providers: csvNumbers,
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("US"),
    seen: z.enum(["all", "seen", "unseen"]).default("all"),
    sentiment: z.enum(["all", "liked", "meh", "disliked", "unrated"]).default("all"),
    list: optionalText(z.uuid()),
    notInList: optionalText(z.uuid()),
    q: z.string().trim().max(200).default(""),
    cursor: z.string().max(600).optional(),
    seed: z.string().max(100).default("discover"),
    exclude: z.preprocess(
      (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v),
      z.array(sourceId).max(200).default([]),
    ),
  })
  .refine(
    (p) => p.yearMin == null || p.yearMax == null || p.yearMin <= p.yearMax,
    "The year range is reversed",
  )
  .refine(
    (p) => p.ratingMin == null || p.ratingMax == null || p.ratingMin <= p.ratingMax,
    "The rating range is reversed",
  )
  .refine((p) => !p.dateMin || !p.dateMax || p.dateMin <= p.dateMax, "The date range is reversed")
  .refine(
    (p) => p.runtimeMin == null || p.runtimeMax == null || p.runtimeMin <= p.runtimeMax,
    "The runtime range is reversed",
  )
  .refine(
    (p) => p.popularityMin == null || p.popularityMax == null || p.popularityMin <= p.popularityMax,
    "The popularity range is reversed",
  );
export type FeedParams = z.infer<typeof feedParams>;
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export type Coverage = {
  state: "missing" | "partial" | "complete" | "stale" | "error";
  projection?: "viewport";
  // A previously complete provider page can remain usable when a refresh fails.
  complete?: boolean;
  fetchedAt: string | null;
  nextCursor: string | null;
  message?: string;
  unsupported: string[];
};
export type QueryResult = {
  id: string;
  entities: Entity[];
  ids: string[];
  coverage: Coverage;
  included?: { id: string; ids: string[]; coverage: Coverage }[];
};
export type EventEnvelope = {
  protocol: 1;
  id: string;
  type: "upsert" | "remove" | "reset" | "complete";
  subscription: string;
  entities: Entity[];
  removed: { kind: Kind; id: string }[];
  timestamp: string;
};
export const sentiment = z.enum(["liked", "meh", "disliked", "unrated"]);
const meta = { operationId: z.uuid() };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    ...meta,
    type: z.literal("status"),
    titleId: titleId,
    seen: z.boolean().optional(),
    sentiment: sentiment.optional(),
  }),
  z.object({
    ...meta,
    type: z.literal("list.create"),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
  }),
  z.object({
    ...meta,
    type: z.literal("list.edit"),
    listId: z.uuid(),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
  }),
  z.object({ ...meta, type: z.literal("list.add"), listId: z.uuid(), titleId: sourceId }),
  z.object({ ...meta, type: z.literal("list.remove"), listId: z.uuid(), itemId: z.uuid() }),
  z.object({
    ...meta,
    type: z.literal("list.move"),
    listId: z.uuid(),
    itemId: z.uuid(),
    beforeId: z.uuid().nullable(),
  }),
  z.object({
    ...meta,
    type: z.literal("list.invite"),
    listId: z.uuid(),
    userId: z.string().min(1),
  }),
  z.object({ ...meta, type: z.literal("invitation.accept"), invitationId: z.uuid() }),
  z.object({ ...meta, type: z.literal("invitation.decline"), invitationId: z.uuid() }),
  z.object({
    ...meta,
    type: z.literal("list.member.remove"),
    listId: z.uuid(),
    userId: z.string(),
  }),
  z.object({ ...meta, type: z.literal("list.follow"), listId: z.uuid(), follow: z.boolean() }),
  z.object({ ...meta, type: z.literal("list.copy"), listId: z.uuid() }),
  z.object({ ...meta, type: z.literal("user.follow"), userId: z.string(), follow: z.boolean() }),
  z.object({
    ...meta,
    type: z.literal("feed.save"),
    title: z.string().min(1).max(100),
    params: feedParams,
  }),
  z.object({
    ...meta,
    type: z.literal("profile"),
    name: z.string().trim().min(1).max(100),
    username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/),
    bio: z.string().max(500),
    image: z.union([
      z.url().refine((v) => v.startsWith("https://"), "Use an HTTPS image URL"),
      z.literal(""),
    ]),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const canEdit = (role: string | undefined) => role === "owner" || role === "editor";
export const canManage = (role: string | undefined) => role === "owner";
export function safeReturnTo(value: string | null | undefined) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/auth") &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/";
}
export function mergeEvent(versions: Map<string, number>, event: EventEnvelope): Entity[] {
  return event.entities.filter((e) => {
    const key = `${e.kind}:${e.id}`;
    if ((versions.get(key) ?? -1) >= e.version) return false;
    versions.set(key, e.version);
    return true;
  });
}

export function fieldText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

export const entitySchema: z.ZodType<Entity> = z.object({
  id: z.string(),
  kind: z.enum(kinds),
  version: z.number().int().nonnegative(),
  title: z.string(),
  name: z.string().optional(),
  overview: z.string().optional(),
  poster: z.string().nullable().optional(),
  backdrop: z.string().nullable().optional(),
  year: z.number().optional(),
  rating: z.number().optional(),
  popularity: z.number().optional(),
  genres: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  data: z.record(z.string(), z.unknown()),
});
export const eventEnvelopeSchema: z.ZodType<EventEnvelope> = z.object({
  protocol: z.literal(1),
  id: z.string().regex(/^\d+$/),
  type: z.enum(["upsert", "remove", "reset", "complete"]),
  subscription: z.string(),
  entities: z.array(entitySchema),
  removed: z.array(z.object({ kind: z.enum(kinds), id: z.string() })),
  timestamp: z.iso.datetime(),
});
