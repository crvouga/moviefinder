import { fieldText, stableSerialize } from "../../shared/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database, Transaction } from "../db";
import { sources } from "../db/schema";
import { appendEvent } from "../events";
import { normalize, kindFor, record, sourceDocument, summarize } from "./normalize";
import type { Entity } from "../../shared/contracts";
export const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createEntityStore(db: Database) {
  async function read(ids: string[]) {
    if (!ids.length) return [];
    const rows = await db.select().from(sources).where(inArray(sources.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? normalize(r.id, r.payload, r.version) : [];
    });
  }
  async function ingest(
    tx: Transaction,
    id: string,
    value: unknown,
    projection: "summary" | "detail" = "summary",
  ): Promise<Entity[]> {
    await tx.execute(sql`select pg_advisory_xact_lock(636712031)`);
    const parsed = sourceDocument.parse(value),
      p = record(parsed),
      [old] = await tx.select().from(sources).where(eq(sources.id, id));
    if (id.split(":").length === 3 && parsed.id !== Number(id.split(":")[2]))
      throw new Error("Upstream identity does not match the requested entity");
    // Discovery summaries must never erase successfully hydrated details.
    const payload =
      projection === "summary" && old?.projection === "detail" ? { ...old.payload, ...p } : p;
    const checksum = digest(stableSerialize(payload)),
      now = new Date(),
      version = (old?.version ?? 0) + 1;
    const release = Date.parse(fieldText(p.release_date ?? p.first_air_date)),
      recent = Number.isFinite(release) && Date.now() - release < 90 * 86400000,
      oldRelease = Number.isFinite(release) && Date.now() - release > 5 * 365 * 86400000;
    const ttl =
      projection === "summary"
        ? 6 * 3600000
        : kindFor(id) === "person"
          ? 7 * 86400000
          : recent || Number(p.popularity ?? 0) > 100
            ? 6 * 3600000
            : oldRelease
              ? 7 * 86400000
              : 86400000;
    const data = {
      id,
      entityType: kindFor(id),
      externalId: id.split(":").slice(2).join(":"),
      payload,
      projection: old?.projection === "detail" ? "detail" : projection,
      checksum,
      fetchedAt: now,
      detailFetchedAt: projection === "detail" ? now : (old?.detailFetchedAt ?? null),
      refreshAt:
        projection === "summary" && old?.projection === "detail"
          ? old.refreshAt
          : new Date(now.getTime() + ttl),
      lastSuccess: now,
      error: null,
      version,
      title: fieldText(p.title ?? p.name ?? old?.title ?? ""),
      genres: (Array.isArray(p.genre_ids)
        ? p.genre_ids
        : Array.isArray(p.genres)
          ? p.genres.map((g) => record(g).id)
          : (old?.genres ?? [])) as number[],
      popularity: Number(p.popularity ?? old?.popularity ?? 0),
      rating: Number(p.vote_average ?? old?.rating ?? 0),
      releaseDate: fieldText(
        p.release_date ?? p.first_air_date ?? p.air_date ?? old?.releaseDate ?? "",
      ),
    };
    if (old?.checksum === checksum && !(projection === "detail" && old.projection !== "detail")) {
      await tx
        .update(sources)
        .set({
          fetchedAt: now,
          lastSuccess: now,
          error: null,
          refreshAt: data.refreshAt,
          detailFetchedAt: data.detailFetchedAt,
        })
        .where(eq(sources.id, id));
      return normalize(id, payload, old.version);
    }
    await tx.insert(sources).values(data).onConflictDoUpdate({ target: sources.id, set: data });
    const entities = normalize(id, payload, version);
    // Subscribers need to know the title changed, not to receive its whole relation graph.
    await appendEvent(tx, `entity:${id}`, entities.filter((e) => e.id === id).map(summarize));
    return entities;
  }
  return { read, ingest };
}
