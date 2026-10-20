import { and, eq, or, ilike, desc, lt, inArray, sql } from "drizzle-orm";
import type { Database } from "./db";
import * as s from "./db/schema";
import { rowEntity } from "./state";
import { summaryOf } from "./entity-store/normalize";
import { AppError } from "./log";
import type { Entity } from "../shared/contracts";
const publicUser = {
  id: s.user.id,
  name: s.user.name,
  username: s.user.username,
  bio: s.user.bio,
  image: s.user.image,
  updatedAt: s.user.updatedAt,
};
export function socialQueries(db: Database) {
  async function titles(ids: string[]) {
    if (!ids.length) return [];
    const rows = await db
      .select()
      .from(s.sources)
      .where(inArray(s.sources.id, [...new Set(ids)]));
    return rows.flatMap((r) => summaryOf(r.id, r.payload, r.version));
  }
  return {
    async search(q: string, cursor = 0) {
      const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`,
        users = await db
          .select(publicUser)
          .from(s.user)
          .where(or(ilike(s.user.name, pattern), ilike(s.user.username, pattern)))
          .orderBy(s.user.id)
          .limit(31)
          .offset(cursor),
        lists = await db
          .select()
          .from(s.lists)
          .where(or(ilike(s.lists.title, pattern), ilike(s.lists.description, pattern)))
          .orderBy(s.lists.id)
          .limit(31)
          .offset(cursor);
      return {
        entities: [
          ...users.slice(0, 30).map((u) => rowEntity("user", u)),
          ...lists.slice(0, 30).map((l) => rowEntity("list", l)),
        ],
        nextCursor: users.length > 30 || lists.length > 30 ? String(cursor + 30) : null,
      };
    },
    async list(id: string, cursor?: string) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read read only`);
        const [list] = await tx.select().from(s.lists).where(eq(s.lists.id, id));
        if (!list) throw new AppError(404, "List not found");
        let after: { key: string; id: string } | undefined;
        if (cursor) {
          try {
            after = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
              key: string;
              id: string;
            };
            if (typeof after.key !== "string" || typeof after.id !== "string") throw new Error();
          } catch {
            throw new AppError(400, "Invalid list cursor");
          }
        }
        const entries = await tx
            .select()
            .from(s.items)
            .where(
              and(
                eq(s.items.listId, id),
                after
                  ? sql`(${s.items.orderKey} collate "C",${s.items.id}) > (${after.key},${after.id})`
                  : undefined,
              ),
            )
            .orderBy(sql`${s.items.orderKey} collate "C"`, s.items.id)
            .limit(201),
          members = await tx.select().from(s.collaborators).where(eq(s.collaborators.listId, id)),
          userIds = [...new Set([list.ownerId, ...members.map((m) => m.userId)])],
          users = await tx.select(publicUser).from(s.user).where(inArray(s.user.id, userIds)),
          entities: Entity[] = [
            rowEntity("list", list),
            ...entries.slice(0, 200).map((e) => rowEntity("item", e)),
            ...members.map((m) => rowEntity("collaborator", m)),
            ...users.map((u) => rowEntity("user", u)),
          ];
        const titleIds = entries.slice(0, 200).map((e) => e.titleId),
          records = titleIds.length
            ? await tx.select().from(s.sources).where(inArray(s.sources.id, titleIds))
            : [];
        for (const r of records) entities.push(...summaryOf(r.id, r.payload, r.version));
        const last = entries[199];
        return {
          entities,
          nextCursor:
            entries.length > 200 && last
              ? Buffer.from(JSON.stringify({ key: last.orderKey, id: last.id })).toString(
                  "base64url",
                )
              : null,
        };
      });
    },
    async profile(id: string, cursor?: string) {
      const [user] = await db.select(publicUser).from(s.user).where(eq(s.user.id, id));
      if (!user) throw new AppError(404, "Profile not found");
      const tags = await db
          .select()
          .from(s.statuses)
          .where(and(eq(s.statuses.userId, id), cursor ? lt(s.statuses.id, cursor) : undefined))
          .orderBy(desc(s.statuses.id))
          .limit(101),
        lists = await db.select().from(s.lists).where(eq(s.lists.ownerId, id)).limit(200);
      return {
        entities: [
          rowEntity("user", user),
          ...tags.slice(0, 100).map((t) => rowEntity("status", t)),
          ...lists.map((l) => rowEntity("list", l)),
          ...(await titles(tags.slice(0, 100).map((t) => t.titleId))),
        ],
        nextCursor: tags.length > 100 ? tags[99]!.id : null,
      };
    },
    async lists(userId: string, scope: "all" | "mine" | "saved", cursor?: string) {
      const access =
        scope === "mine"
          ? sql`(${s.lists.ownerId}=${userId} or exists(select 1 from moviefinder.collaborator c where c.list_id=${s.lists.id} and c.user_id=${userId}))`
          : scope === "saved"
            ? sql`exists(select 1 from moviefinder.follow f where f.target_id=${s.lists.id} and f.user_id=${userId} and f.target_kind='list')`
            : undefined;
      const rows = await db
          .select()
          .from(s.lists)
          .where(and(access, cursor ? lt(s.lists.id, cursor) : undefined))
          .orderBy(desc(s.lists.id))
          .limit(51),
        selected = rows.slice(0, 50),
        ids = selected.map((r) => r.id),
        members = ids.length
          ? await db
              .select()
              .from(s.collaborators)
              .where(and(eq(s.collaborators.userId, userId), inArray(s.collaborators.listId, ids)))
          : [],
        saved = ids.length
          ? await db
              .select()
              .from(s.follows)
              .where(
                and(
                  eq(s.follows.userId, userId),
                  eq(s.follows.targetKind, "list"),
                  inArray(s.follows.targetId, ids),
                ),
              )
          : [];
      return {
        entities: [
          ...selected.map((l) => rowEntity("list", l)),
          ...members.map((m) => rowEntity("collaborator", m)),
          ...saved.map((f) => rowEntity("follow", f)),
        ],
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    },
  };
}
