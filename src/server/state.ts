import { fieldText } from "../shared/contracts";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database, Executor } from "./db";
import * as s from "./db/schema";
import type { Entity, Kind } from "../shared/contracts";
import { currentCursor } from "./events";
export function rowEntity(kind: Kind, row: Record<string, unknown>): Entity {
  const { id, version, ...data } = row;
  return {
    id: fieldText(id),
    kind,
    version: Number(version ?? (row.updatedAt instanceof Date ? row.updatedAt.getTime() : 1)),
    title: fieldText(row.title ?? row.name ?? ""),
    poster: kind === "user" ? fieldText(row.image ?? "") || null : undefined,
    data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
  };
}
export async function socialState(db: Executor, userId: string) {
  const entities: Entity[] = [];
  const users = await db
    .select({
      id: s.user.id,
      name: s.user.name,
      username: s.user.username,
      image: s.user.image,
      bio: s.user.bio,
      updatedAt: s.user.updatedAt,
    })
    .from(s.user)
    .limit(500);
  entities.push(...users.map((r) => rowEntity("user", r)));
  const sets = [
    await db.select().from(s.lists).orderBy(desc(s.lists.updatedAt)).limit(250),
    await db.select().from(s.items).limit(5000),
    await db.select().from(s.collaborators).limit(1000),
    await db.select().from(s.statuses).orderBy(desc(s.statuses.updatedAt)).limit(2000),
    await db.select().from(s.activities).orderBy(desc(s.activities.createdAt)).limit(250),
    await db.select().from(s.feeds).where(eq(s.feeds.userId, userId)),
    await db.select().from(s.follows).where(eq(s.follows.userId, userId)),
    await db
      .select()
      .from(s.invitations)
      .where(or(eq(s.invitations.userId, userId), eq(s.invitations.invitedBy, userId))),
  ];
  const kinds: Kind[] = [
    "list",
    "item",
    "collaborator",
    "status",
    "activity",
    "feed",
    "follow",
    "invitation",
  ];
  sets.forEach((rows, i) => entities.push(...rows.map((r) => rowEntity(kinds[i]!, r))));
  return entities;
}
export async function snapshot(db: Database, userId: string) {
  // Repeatable read pairs an internally consistent snapshot with its replay watermark.
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const cursor = await currentCursor(tx);
    const entities = await socialState(tx, userId);
    const ids = [
      ...new Set(
        entities
          .filter((e) => e.kind === "item" || e.kind === "status")
          .map((e) => fieldText(e.data.titleId)),
      ),
    ];
    const rows = ids.length
      ? await tx.select().from(s.sources).where(inArray(s.sources.id, ids))
      : [];
    const { summaryOf } = await import("./entity-store/normalize");
    for (const r of rows) entities.push(...summaryOf(r.id, r.payload, r.version));
    return { entities, cursor };
  });
}
