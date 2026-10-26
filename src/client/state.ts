import { RequestPool } from "./request-pool";
import { mergeEntity } from "../shared/detail-graph";
import { prepareGraphArtwork } from "./graph-artwork";
import { createOutbox } from "./outbox";
import {
  track,
  measure,
  span,
  count,
  gauge,
  contextFor,
  bindContext,
  telemetryKey,
} from "./telemetry";
const outbox = createOutbox(window.localStorage);
const itemAliases = new Map<string, string>();
import { fieldText } from "../shared/contracts";
import {
  createCollection,
  createOptimisticAction,
  useLiveQuery,
  eq,
  inArray,
} from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { QueryClient } from "@tanstack/react-query";
import { hc } from "hono/client";
import { generateKeyBetween } from "fractional-indexing";
import type { AppType } from "../server/app";
import {
  stableSerialize,
  kinds,
  type Entity,
  type Kind,
  type Command,
  type QueryResult,
  eventEnvelopeSchema,
  type FeedParams,
} from "../shared/contracts";
export { authClient } from "./auth-client";
export const api = hc<AppType>("/");
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
export async function readResponse<T>(res: Pick<Response, "ok" | "status" | "json">): Promise<T> {
  if (res.status === 401) {
    window.location.assign(
      `/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
    );
    throw new Error("Your session expired. Sign in again.");
  }
  let data;
  try {
    data = await span("parse", "body", () => res.json(), contextFor(res));
    if (data && typeof data === "object") {
      bindContext(data, contextFor(res));
      if (Array.isArray(data.entities)) bindContext(data.entities, contextFor(res));
      if (Array.isArray(data.results))
        for (const result of data.results)
          if (Array.isArray(result.entities)) bindContext(result.entities, contextFor(res));
    }
  } catch {
    throw new Error("We couldn’t reach MovieFinder. Try again shortly.");
  }
  if (!res.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : Array.isArray(data?.error?.issues)
            ? data.error.issues[0]?.message
            : undefined;
    throw new Error(message ?? "This request could not be completed");
  }
  return data as T;
}
let initialRequest: Promise<{ entities: Entity[]; cursor: string }> | undefined;
const loadSnapshot = () =>
  (initialRequest ??= span("snapshot", "load", () =>
    api.api.state.$get().then((r) => readResponse<{ entities: Entity[]; cursor: string }>(r)),
  )
    .then((state) => {
      track("snapshot", "size", { entities: state.entities.length });
      return state;
    })
    .catch((error) => {
      initialRequest = undefined;
      throw error;
    }));
function makeCollection(kind: Kind) {
  return createCollection(
    queryCollectionOptions<Entity>({
      id: `entities:${kind}`,
      queryKey: ["entities", kind],
      queryClient,
      getKey: (e) => e.id,
      queryFn: async () => {
        const state = await loadSnapshot();
        return state.entities.filter((e) => e.kind === kind);
      },
      staleTime: Infinity,
      gcTime: Infinity,
      retry: 1,
      refetchOnReconnect: false,
    }),
  );
}
export const collections = Object.fromEntries(
  kinds.map((kind) => [kind, makeCollection(kind)]),
) as Record<Kind, ReturnType<typeof makeCollection>>;
gauge(() => Object.fromEntries(kinds.map((kind) => [`n_${kind}`, collections[kind].size])));
const versions = new Map<string, number>();
let loaded: Promise<unknown> | undefined;
export const collectionsReady = () =>
  (loaded ??= Promise.all(Object.values(collections).map((c) => c.preload())).catch((error) => {
    loaded = undefined;
    throw error;
  }));
// Writes apply synchronously and wake every live query. Issuing all of them in one tick lets
// React render once instead of once per collection, so never await between them.
function applyMerge(entities: Entity[]) {
  const groups = new Map<Kind, Entity[]>();
  for (const e of entities) {
    const key = `${e.kind}:${e.id}`;
    const known = versions.get(key) ?? -1;
    const next = mergeEntity(collections[e.kind].get(e.id), e, known);
    if (!next) continue;
    versions.set(key, e.version);
    const group = groups.get(e.kind) ?? [];
    group.push(next);
    groups.set(e.kind, group);
  }
  const writes: Promise<void>[] = [];
  for (const [kind, values] of groups) {
    const unique = [...new Map(values.map((e) => [e.id, e])).values()];
    writes.push(
      measure(
        "merge",
        kind,
        () => collections[kind].utils.writeUpsert(unique),
        { entities: unique.length, size: collections[kind].size },
        2,
      ),
    );
  }
  return writes;
}
function applyRemove(removed: { kind: Kind; id: string }[]) {
  const writes: Promise<void>[] = [];
  for (const r of removed) {
    versions.set(`${r.kind}:${r.id}`, Infinity);
    if (collections[r.kind].has(r.id)) writes.push(collections[r.kind].utils.writeDelete(r.id));
  }
  return writes;
}
type QueryRow = Entity;
async function commit(change: {
  entities?: Entity[];
  removed?: { kind: Kind; id: string }[];
  query?: QueryRow | QueryRow[];
}) {
  const began = performance.now();
  await collectionsReady();
  const queries = change.query ? [change.query].flat() : [];
  await Promise.all([
    ...applyMerge(change.entities ?? []),
    ...applyRemove(change.removed ?? []),
    ...(queries.length ? [collections.query.utils.writeUpsert(queries)] : []),
  ]);
  track("merge", "commit", {
    ...contextFor(change.entities),
    ms: performance.now() - began,
    entities: change.entities?.length ?? 0,
  });
}
export const merge = (entities: Entity[]) => commit({ entities });
export function useEntities(kind: Kind, ids?: readonly string[]) {
  count(`render.useEntities.${kind}`);
  const result = useLiveQuery({
    queryKey: ["entity-view", kind, ids ? ids.join("|") : "all"],
    query: (q) =>
      ids
        ? q.from({ entity: collections[kind] }).where(({ entity }) => inArray(entity.id, [...ids]))
        : q.from({ entity: collections[kind] }),
  });
  // A live query establishes its subscription asynchronously. Read the same canonical rows
  // during that first render instead of flashing empty cast/genres/cards in a prepared graph.
  if (!result.isReady)
    return ids
      ? ids.flatMap((id) => {
          const entity = collections[kind].get(id);
          return entity ? [entity] : [];
        })
      : [...collections[kind].values()];
  return (result.data ?? []) as Entity[];
}
export function useEntity(id: string | undefined) {
  const kind: Kind = id?.includes(":episode:")
    ? "episode"
    : id?.includes(":season:")
      ? "season"
      : id?.startsWith("tmdb:")
        ? (id.split(":")[1] as Kind)
        : "movie";
  const result = useLiveQuery({
    queryKey: ["single-entity", kind, id ?? ""],
    query: (q) =>
      q.from({ entity: collections[kind] }).where(({ entity }) => eq(entity.id, id ?? "")),
  });
  return result.isReady ? result.data?.[0] : collections[kind].get(id ?? "");
}
export function getEntity(id: string) {
  for (const c of Object.values(collections)) {
    const e = c.get(id);
    if (e) return e;
  }
}
import { notices, report } from "./notifications";
export { notices, notify, report } from "./notifications";
let syncRetry: ReturnType<typeof setTimeout> | undefined,
  syncEpoch = 0,
  syncFailures = 0;
let eventBatch: string[] = [],
  eventTimer: ReturnType<typeof setTimeout> | undefined;
let source: EventSource | undefined,
  started = false,
  eventQueue = Promise.resolve();
// Live interest in a server subscription (a feed page or a title); events for it re-read it.
const subscriptions = new Map<string, { reload: () => Promise<unknown>; users: number }>();
export function encodeParams(p: FeedParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : fieldText(v)]),
  );
}
export const requests = new RequestPool<string | null>(3, (event, fields) =>
  track("pool", event, {
    ...fields,
    key: typeof fields.key === "string" ? telemetryKey(fields.key) : undefined,
  }),
);
// Cached reads are dropped precisely when an event or command says they changed (see
// `staleKeys`), so a result can be trusted for a while. Incomplete ones are still followed live.
const ttlFor = (state: string | undefined) => (state === "complete" ? 60_000 : 5_000);
const queryTTL = (id: string) =>
  ttlFor((collections.query.get(id)?.data.coverage as { state?: string } | undefined)?.state);
// Which cached reads an event for these subscriptions (or a reset) makes stale.
function staleKeys(subscriptionIds: Iterable<string>, reset = false) {
  const ids = [...subscriptionIds];
  return (key: string) =>
    reset ||
    ids.some((id) =>
      id.startsWith("entity:")
        ? key === id
        : id.startsWith("discover:")
          ? key.startsWith("discover:")
          : key.startsWith("social:") || key.startsWith("discover:"),
    );
}
export function discover(
  params: FeedParams,
  signal?: AbortSignal,
  speculative = false,
  ready = false,
): Promise<string> {
  let id = "";
  return requests.run(
    `discover:${stableSerialize(params)}`,
    async (sharedSignal) => {
      id = await span("load", "discover", () => readDiscovery(params, sharedSignal, ready), {
        speculative,
        ...contextFor(sharedSignal),
      });
      return id;
    },
    {
      signal,
      speculative,
      ttl: () => queryTTL(id),
      fresh: ready ? (id) => !!id && queryReady(id) : undefined,
    },
  ) as Promise<string>;
}
async function readDiscovery(params: FeedParams, signal: AbortSignal, ready = false) {
  const result = await readResponse<QueryResult>(
    await api.api.discover.$get(
      { query: { ...encodeParams(params), ...(ready ? { ready: "1" as const } : {}) } },
      { init: { signal } },
    ),
  );
  signal.throwIfAborted();
  await commit({
    entities: result.entities,
    query: {
      id: result.id,
      kind: "query",
      version: Date.now(),
      title: "Discovery",
      data: { ids: result.ids, coverage: result.coverage, params },
    },
  });
  return result.id;
}
// A hydration job emits an event every few titles. One trailing read per query is enough.
const refetches = new Map<string, ReturnType<typeof setTimeout>>();
function refetchSoon(id: string) {
  if (refetches.has(id)) return;
  refetches.set(
    id,
    setTimeout(() => {
      refetches.delete(id);
      const sub = subscriptions.get(id);
      if (!sub) return;
      // The hydration response may already have committed the version announced by SSE.
      // Don't read/merge the identical graph again 300 ms later.
      if (id.startsWith("entity:")) {
        const entity = getEntity(id.slice("entity:".length));
        if (entity && hydrated(entity.id) && entity.data.graphVersion === entity.version) return;
      }
      // The response that raised this event may have settled after it; never reuse that one.
      requests.invalidate(staleKeys([id]));
      void sub.reload().catch(report);
    }, 300),
  );
}
export function subscribeQuery(id: string, params: FeedParams) {
  const current = subscriptions.get(id);
  subscriptions.set(id, { reload: () => discover(params), users: (current?.users ?? 0) + 1 });
  const metadata = collections.query.get(id);
  if ((metadata?.data.coverage as { state?: string } | undefined)?.state !== "complete")
    void discover(params).catch(report);
  return () => {
    const sub = subscriptions.get(id);
    if (sub && sub.users > 1) sub.users--;
    else subscriptions.delete(id);
  };
}
// Hydration completes after the first response, and events carry only summaries, so a title on
// screen re-reads itself when its subscription changes.
export function subscribeEntity(id: string) {
  const key = `entity:${id}`,
    current = subscriptions.get(key);
  subscriptions.set(key, { reload: () => loadEntity(id), users: (current?.users ?? 0) + 1 });
  return () => {
    const sub = subscriptions.get(key);
    if (sub && sub.users > 1) sub.users--;
    else subscriptions.delete(key);
  };
}
const coverageOf = (id: string) =>
  (collections.query.get(`entity:${id}`)?.data.coverage as { state?: string } | undefined)?.state;
const hydrated = (id: string) => {
  const entity = getEntity(id);
  return (
    !!entity &&
    ["complete", "stale"].includes(coverageOf(id) ?? "") &&
    entity.data.graphScope !== "viewport" &&
    entity.data.summary !== true &&
    entity.data.graphVersion === entity.version
  );
};
export function queryReady(id: string) {
  const coverage = collections.query.get(id)?.data.coverage as
    | { state?: string; complete?: boolean; projection?: string }
    | undefined;
  return (
    coverage?.projection !== "viewport" &&
    (coverage?.state === "complete" || coverage?.state === "stale" || coverage?.complete === true)
  );
}
export async function loadEntity(
  id: string,
  signal?: AbortSignal,
  speculative = false,
  ready = false,
) {
  const read = () =>
    requests.run(
      `entity:${id}`,
      (sharedSignal) =>
        span("load", "entity", () => readEntity(id, sharedSignal, speculative, ready), {
          speculative,
          ...contextFor(sharedSignal),
        }),
      {
        signal,
        speculative,
        // Reuse complete graphs until an event or TTL invalidates the read.
        ttl: () => (speculative ? 60_000 : queryTTL(`entity:${id}`)),
        // Cache-only hints and progressive reads cannot satisfy a ready destination.
        fresh: () => hydrated(id),
      },
    );
  const result = await read();
  // The request this one joined may have been a hover read that was already in flight.
  return (!speculative || ready) && !hydrated(id) && !signal?.aborted ? read() : result;
}
// Warms several titles with one request. Each is then answered from the pool like a single read.
export function loadTitles(ids: string[], signal?: AbortSignal) {
  const wanted = [...new Set(ids)].filter((id) => !requests.has(`entity:${id}`)).sort();
  if (!wanted.length) return Promise.resolve(null);
  return requests.run(
    `titles:${wanted.join(",")}`,
    (sharedSignal) =>
      span("load", "titles", () => readTitles(wanted, sharedSignal), {
        count: wanted.length,
        ...contextFor(sharedSignal),
      }),
    { signal, speculative: true, ttl: () => 5_000 },
  );
}
async function readTitles(ids: string[], signal: AbortSignal) {
  const { results } = await readResponse<{ results: QueryResult[] }>(
    await api.api.titles.$get({ query: { ids: ids.join(",") } }, { init: { signal } }),
  );
  signal.throwIfAborted();
  await commit({
    entities: results.flatMap((r) => r.entities),
    query: results.map((r) => ({
      id: r.id,
      kind: "query" as const,
      version: Date.now(),
      title: "Details",
      data: { ids: r.ids, coverage: r.coverage },
    })),
  });
  for (const r of results) requests.prime(r.id, r.id, ttlFor(r.coverage.state), true);
  return null;
}
async function readEntity(id: string, signal: AbortSignal, speculative: boolean, ready = false) {
  const res = await readResponse<QueryResult>(
    await api.api.title[":id"].$get(
      {
        param: { id },
        query: {
          ...(speculative ? { warm: "1" as const } : {}),
          ...(ready ? { ready: "1" as const } : {}),
        },
      },
      { init: { signal } },
    ),
  );
  signal.throwIfAborted();
  // Artwork can download while the graph is being committed and rendered.
  void prepareGraphArtwork(
    res.entities,
    [...res.ids, ...(res.included?.flatMap((g) => g.ids) ?? [])],
    getEntity,
    signal,
    !speculative,
  ).catch(() => {});
  const graphRows = [res, ...(res.included ?? [])];
  await commit({
    entities: res.entities,
    query: graphRows
      .filter((graph) => graph.coverage.projection !== "viewport" || !queryReady(graph.id))
      .filter((graph) => {
        const held = collections.query.get(graph.id);
        return (
          !held ||
          stableSerialize(held.data.coverage) !== stableSerialize(graph.coverage) ||
          stableSerialize(held.data.ids) !== stableSerialize(graph.ids)
        );
      })
      .map((graph) => ({
        id: graph.id,
        kind: "query" as const,
        version: Date.now(),
        title: "Details",
        data: { ids: graph.ids, coverage: graph.coverage },
      })),
  });
  return res.id;
}
export async function startSync(userId: string) {
  if (started) return;
  started = true;
  const begun = performance.now();
  const epoch = syncEpoch;
  try {
    await Promise.all(
      Object.values(collections)
        .filter((c) => c.utils.isError)
        .map((c) => c.utils.refetch({ throwOnError: true })),
    );
    const state = await loadSnapshot();
    await span("sync", "preload", () => collectionsReady(), { entities: state.entities.length });
    if (epoch !== syncEpoch) return;
    syncFailures = 0;
    track("sync", "ready", {
      ms: Math.round(performance.now() - begun),
      entities: state.entities.length,
    });
    for (const e of state.entities) versions.set(`${e.kind}:${e.id}`, e.version);
    for (const pending of outbox.read(userId)) void command(pending, userId, pending).catch(report);
    let last = Number(state.cursor);
    source = new EventSource(`/api/events?cursor=${state.cursor}`);
    // Hydrating one page emits an event per title. Apply a burst as one commit and one render.
    const apply = async (raw: string[]) => {
      const handling = performance.now();
      let entities: Entity[] = [],
        removed: { kind: Kind; id: string }[] = [];
      const refetch = new Set<string>();
      let reset = false,
        events = 0;
      for (const data of raw) {
        const event = eventEnvelopeSchema.parse(JSON.parse(data));
        if (event.protocol !== 1 || Number(event.id) <= last) continue;
        if (event.type === "reset") {
          for (const [kind, c] of Object.entries(collections)) {
            const keys = [...c.keys()].filter(
              (id) => kind === "query" || versions.has(`${kind}:${id}`),
            );
            if (keys.length) await c.utils.writeDelete(keys);
          }
          versions.clear();
          // A snapshot supersedes everything accumulated before it.
          entities = [];
          removed = [];
          reset = true;
        }
        entities.push(...event.entities);
        removed.push(...event.removed);
        refetch.add(event.subscription);
        last = Number(event.id);
        events++;
      }
      if (!events) return;
      await commit({ entities, removed });
      // A hydration response may already contain exactly the source version announced by
      // its event. Preserve that fresh pool entry instead of expiring it immediately.
      const changed = new Set(
        [...refetch].filter(
          (id) => !id.startsWith("entity:") || !hydrated(id.slice("entity:".length)),
        ),
      );
      requests.invalidate(staleKeys(changed, reset));
      track("sse", "batch", {
        ms: Math.round(performance.now() - handling),
        events,
        entities: entities.length,
        removed: removed.length,
      });
      for (const [id] of subscriptions) if (reset || refetch.has(id)) refetchSoon(id);
    };
    source.addEventListener("change", (message: MessageEvent) => {
      eventBatch.push(message.data);
      eventTimer ??= setTimeout(() => {
        const raw = eventBatch;
        eventBatch = [];
        eventTimer = undefined;
        eventQueue = eventQueue.then(() => apply(raw)).catch(report);
      }, 40);
    });
    source.addEventListener("error", () =>
      notices.dispatchEvent(new CustomEvent("connection", { detail: "reconnecting" })),
    );
    source.addEventListener("open", () =>
      notices.dispatchEvent(new CustomEvent("connection", { detail: "live" })),
    );
  } catch (error) {
    started = false;
    if (epoch === syncEpoch)
      syncRetry = setTimeout(
        () => void startSync(userId).catch(report),
        Math.min(30000, 1000 * 2 ** Math.min(++syncFailures, 5)),
      );
    throw error;
  }
}
export function stopSync() {
  requests.clear();
  clearTimeout(eventTimer);
  eventTimer = undefined;
  eventBatch = [];
  for (const timer of refetches.values()) clearTimeout(timer);
  refetches.clear();
  syncEpoch++;
  if (syncRetry) clearTimeout(syncRetry);
  source?.close();
  started = false;
}
const lanes = new Map<string, Promise<unknown>>();
function optimistic(command: Command, userId: string) {
  const put = (e: Entity) => {
    const c = collections[e.kind];
    if (c.has(e.id)) c.update(e.id, (d) => Object.assign(d, e));
    else c.insert(e);
  };
  const basic = (kind: Kind, id: string, title: string, data: Record<string, unknown>): Entity => ({
    kind,
    id,
    title,
    data,
    version: 0,
  });
  switch (command.type) {
    case "status": {
      const id = `${userId}:${command.titleId}`,
        old = collections.status.get(id);
      put({
        ...basic("status", id, "", {
          userId,
          titleId: command.titleId,
          seen: false,
          sentiment: "unrated",
          ...old?.data,
          ...(command.seen === undefined ? {} : { seen: command.seen }),
          ...(command.sentiment === undefined ? {} : { sentiment: command.sentiment }),
        }),
        version: old?.version ?? 0,
      });
      break;
    }
    case "list.create":
      put(
        basic("list", command.operationId, command.title, {
          ownerId: userId,
          description: command.description,
        }),
      );
      put(
        basic("collaborator", command.operationId, "", {
          listId: command.operationId,
          userId,
          role: "owner",
        }),
      );
      break;
    case "list.edit": {
      const e = collections.list.get(command.listId);
      if (e)
        put({ ...e, title: command.title, data: { ...e.data, description: command.description } });
      break;
    }
    case "list.add": {
      const rows = [...collections.item.values()]
        .filter((e) => e.data.listId === command.listId)
        .sort((a, b) => (fieldText(a.data.orderKey) < fieldText(b.data.orderKey) ? -1 : 1));
      if (rows.some((e) => e.data.titleId === command.titleId)) break;
      put(
        basic("item", command.operationId, "", {
          listId: command.listId,
          titleId: command.titleId,
          addedBy: userId,
          orderKey: generateKeyBetween(fieldText(rows.at(-1)?.data.orderKey ?? "") || null, null),
        }),
      );
      break;
    }
    case "list.remove":
      if (collections.item.has(command.itemId)) collections.item.delete(command.itemId);
      break;
    case "list.move": {
      const e = collections.item.get(command.itemId);
      if (!e) break;
      const rest = [...collections.item.values()]
        .filter((r) => r.data.listId === command.listId && r.id !== e.id)
        .sort((a, b) => (fieldText(a.data.orderKey) < fieldText(b.data.orderKey) ? -1 : 1));
      let i = command.beforeId ? rest.findIndex((r) => r.id === command.beforeId) : rest.length;
      if (i < 0) i = rest.length;
      put({
        ...e,
        data: {
          ...e.data,
          orderKey: generateKeyBetween(
            rest[i - 1] ? fieldText(rest[i - 1]!.data.orderKey) : null,
            rest[i] ? fieldText(rest[i]!.data.orderKey) : null,
          ),
        },
      });
      break;
    }
    case "profile": {
      const e = collections.user.get(userId);
      if (e)
        put({
          ...e,
          title: command.name,
          poster: command.image,
          data: {
            ...e.data,
            name: command.name,
            username: command.username,
            bio: command.bio,
            image: command.image,
          },
        });
      break;
    }
    case "list.follow":
    case "user.follow": {
      const targetId = command.type === "list.follow" ? command.listId : command.userId,
        targetKind = command.type === "list.follow" ? "list" : "user",
        existing = [...collections.follow.values()].find(
          (e) =>
            e.data.userId === userId &&
            e.data.targetId === targetId &&
            e.data.targetKind === targetKind,
        ),
        id = existing?.id ?? command.operationId;
      if (command.follow) put(basic("follow", id, "", { userId, targetId, targetKind }));
      else if (collections.follow.has(id)) collections.follow.delete(id);
      break;
    }
    case "feed.save":
      put(basic("feed", command.operationId, command.title, { userId, params: command.params }));
      break;
    case "list.copy": {
      const original = collections.list.get(command.listId);
      if (original) {
        put(
          basic("list", command.operationId, `${original.title} (copy)`, {
            ownerId: userId,
            description: original.data.description ?? "",
          }),
        );
        put(
          basic("collaborator", command.operationId, "", {
            listId: command.operationId,
            userId,
            role: "owner",
          }),
        );
      }
      break;
    }
    case "list.invite": {
      const old = [...collections.invitation.values()].find(
        (e) => e.data.listId === command.listId && e.data.userId === command.userId,
      );
      put(
        basic("invitation", old?.id ?? command.operationId, "", {
          ...old?.data,
          listId: command.listId,
          userId: command.userId,
          invitedBy: userId,
          state: "pending",
        }),
      );
      break;
    }
    case "invitation.accept":
    case "invitation.decline": {
      const invitation = collections.invitation.get(command.invitationId);
      if (invitation) {
        put({
          ...invitation,
          data: {
            ...invitation.data,
            state: command.type === "invitation.accept" ? "accepted" : "declined",
          },
        });
        if (
          command.type === "invitation.accept" &&
          ![...collections.collaborator.values()].some(
            (m) => m.data.listId === invitation.data.listId && m.data.userId === userId,
          )
        )
          put(
            basic("collaborator", command.operationId, "", {
              listId: invitation.data.listId,
              userId,
              role: "editor",
            }),
          );
      }
      break;
    }
    case "list.member.remove": {
      const member = [...collections.collaborator.values()].find(
        (e) => e.data.listId === command.listId && e.data.userId === command.userId,
      );
      if (member) collections.collaborator.delete(member.id);
      for (const invitation of collections.invitation.values())
        if (
          invitation.data.listId === command.listId &&
          invitation.data.userId === command.userId &&
          invitation.data.state === "pending"
        )
          put({ ...invitation, data: { ...invitation.data, state: "declined" } });
      break;
    }
    default:
      break;
  }
}
export async function command(
  input: Omit<Command, "operationId">,
  userId: string,
  replayValue?: Command,
): Promise<{ entities: Entity[]; removed: { kind: Kind; id: string }[] }> {
  const value = replayValue ?? ({ ...input, operationId: crypto.randomUUID() } as Command);
  outbox.put(userId, value);
  let result: { entities: Entity[]; removed: { kind: Kind; id: string }[] } = {
    entities: [],
    removed: [],
  };
  const persist = async (c: Command) => {
    const listId =
      c.type === "list.create" || c.type === "list.copy"
        ? c.operationId
        : "listId" in c
          ? c.listId
          : c.type === "invitation.accept" || c.type === "invitation.decline"
            ? fieldText(collections.invitation.get(c.invitationId)?.data.listId)
            : undefined;
    const key = listId ? `list:${listId}` : `user:${userId}`,
      previous = lanes.get(key) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const saved = outbox.read(userId).find((p) => p.operationId === c.operationId) ?? c;
        const resolved =
          saved.type === "list.move"
            ? {
                ...saved,
                itemId: itemAliases.get(saved.itemId) ?? saved.itemId,
                beforeId: saved.beforeId
                  ? (itemAliases.get(saved.beforeId) ?? saved.beforeId)
                  : null,
              }
            : saved.type === "list.remove"
              ? { ...saved, itemId: itemAliases.get(saved.itemId) ?? saved.itemId }
              : saved;
        // Retry a transport interruption with the same ID; the database deduplicates it.
        let response: Awaited<ReturnType<typeof api.api.command.$post>>;
        try {
          response = await api.api.command.$post({ json: resolved }, { init: { keepalive: true } });
        } catch {
          response = await api.api.command.$post({ json: resolved }, { init: { keepalive: true } });
        }
        result = await readResponse(response);
        if (c.type === "list.add") {
          const item = result.entities.find(
            (e) => e.kind === "item" && e.data.titleId === c.titleId,
          );
          if (item && item.id !== c.operationId) {
            itemAliases.set(c.operationId, item.id);
            outbox.alias(userId, c.operationId, item.id);
          }
        }
        // Commands change what feeds and lists show; the entities they touch arrive merged.
        requests.invalidate((key) => !key.startsWith("entity:"));
        await commit(result);
      });
    lanes.set(key, pending);
    try {
      await pending;
    } finally {
      outbox.remove(userId, c.operationId);
      if (lanes.get(key) === pending) lanes.delete(key);
    }
  };
  const action = createOptimisticAction<Command>({
    onMutate: (c) => optimistic(c, userId),
    mutationFn: persist,
  });
  const tx = action(value);
  if (tx.mutations.length === 0) await persist(value);
  else await tx.isPersisted.promise;
  return result;
}
export type CommandInput = Command extends infer C
  ? C extends { operationId: string }
    ? Omit<C, "operationId">
    : never
  : never;
export async function send(input: CommandInput, userId: string) {
  return command(input as Omit<Command, "operationId">, userId);
}

async function readSocial(
  kind: "list" | "profile" | "lists" | "search",
  value: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const response =
    kind === "list"
      ? await api.api.lists[":id"].$get(
          { param: { id: value }, query: cursor ? { cursor } : {} },
          { init: { signal } },
        )
      : kind === "profile"
        ? await api.api.profiles[":id"].$get(
            {
              param: { id: value },
              query: cursor ? { cursor } : {},
            },
            { init: { signal } },
          )
        : kind === "lists"
          ? await api.api.lists.$get(
              {
                query: {
                  scope: value === "yours" ? "mine" : value === "saved" ? "saved" : "all",
                  ...(cursor ? { cursor } : {}),
                },
              },
              { init: { signal } },
            )
          : await api.api["social-search"].$get(
              {
                query: { q: value, ...(cursor ? { cursor } : {}) },
              },
              { init: { signal } },
            );
  const result = await readResponse<{ entities: Entity[]; nextCursor: string | null }>(response);
  signal.throwIfAborted();
  await commit({
    entities: result.entities,
    query: {
      id: `social:${kind}:${value}`,
      kind: "query",
      version: Date.now(),
      title: kind,
      data: { nextCursor: result.nextCursor },
    },
  });
  return result.nextCursor;
}

export function loadSocial(
  kind: "list" | "profile" | "lists" | "search",
  value: string,
  cursor?: string,
  signal?: AbortSignal,
  speculative = false,
) {
  return requests.run(
    `social:${stableSerialize([kind, value, cursor])}`,
    (sharedSignal) =>
      span("load", "social", () => readSocial(kind, value, cursor, sharedSignal), {
        scope: kind,
        speculative,
        ...contextFor(sharedSignal),
      }),
    { signal, speculative, ttl: () => 60_000 },
  );
}
