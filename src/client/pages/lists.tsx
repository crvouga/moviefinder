import { feedParams } from "../../shared/contracts";
import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useRef, useState } from "react";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import {
  Plus,
  ArrowUpRight,
  Bookmark,
  GripVertical,
  Heart,
  Eye,
  Trash2,
  Copy,
  UserPlus,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Pencil,
  Search,
  Check,
} from "lucide-react";
import type { Entity } from "../../shared/contracts";
import { useEntities, send, report, notify, discover, subscribeQuery, loadSocial } from "../state";
import { Poster, PageHeading, Empty } from "../components/common";
import { useListItems, useTitles, useUsers, useViewerStatuses } from "../components/viewer";
import { Button } from "../components/ui/button";
import { Sheet } from "../components/ui/dialog";
export const ListCard = memo(function ListCard({ list }: { list: Entity }) {
  const entries = useListItems(list.id),
    byId = useTitles(),
    owner = useUsers().get(fieldText(list.data.ownerId));
  return (
    <Link to="/lists/$listId" params={{ listId: list.id }} className="list-card">
      <div className="list-art">
        {entries.length ? (
          entries
            .slice(0, 3)
            .map((entry, i) => (
              <Poster
                key={entry.id}
                entity={byId.get(fieldText(entry.data.titleId))}
                slot="thumb"
                className={`list-cover list-cover-${i}`}
              />
            ))
        ) : (
          <>
            <Bookmark size={44} />
            <span>A good story starts with a list.</span>
          </>
        )}
        <span className="list-open">
          <ArrowUpRight size={20} />
        </span>
      </div>
      <h3>{list.title}</h3>
      <p>
        {entries.length} titles <span>·</span> by {owner?.title ?? "a movie lover"}
      </p>
    </Link>
  );
});
export function ListsPage({ userId }: { userId: string }) {
  const lists = useEntities("list"),
    members = useEntities("collaborator"),
    follows = useEntities("follow"),
    [tab, setTab] = useState("yours"),
    [create, setCreate] = useState(false);
  const queryRows = useEntities("query"),
    nextPage = queryRows.find((q) => q.id === `social:lists:${tab}`)?.data.nextCursor as
      | string
      | null
      | undefined;
  useEffect(() => {
    const controller = new AbortController();
    void loadSocial("lists", tab, undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [tab]);
  const visible = lists.filter(
    (l) =>
      tab === "explore" ||
      (tab === "yours" &&
        members.some((m) => m.data.listId === l.id && m.data.userId === userId)) ||
      (tab === "saved" && follows.some((f) => f.data.targetId === l.id)),
  );
  return (
    <div className="standard-page">
      <PageHeading eyebrow="GOOD TASTE IS BETTER SHARED" title="A list for every kind of night.">
        <Button onClick={() => setCreate(true)}>
          <Plus size={17} />
          New list
        </Button>
      </PageHeading>
      <div className="section-tabs">
        {[
          ["yours", "Your collections"],
          ["saved", "Saved lists"],
          ["explore", "Explore lists"],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key!)}>
            {label}
          </button>
        ))}
      </div>
      {visible.length ? (
        <div className="list-grid">
          {visible.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </div>
      ) : (
        <Empty
          title={
            tab === "saved"
              ? "Borrow a little good taste."
              : "Every great movie night starts somewhere."
          }
        >
          {tab === "saved"
            ? "Explore public lists and save the ones that speak to you."
            : "Keep your favorites close, build a watchlist, or invite a friend to help pick the next one."}
        </Empty>
      )}
      {nextPage && (
        <Button
          variant="outline"
          onClick={() => void loadSocial("lists", tab, nextPage).catch(report)}
        >
          More collections
        </Button>
      )}
      <ListEditor open={create} setOpen={setCreate} userId={userId} />
    </div>
  );
}
function ListEditor({
  open,
  setOpen,
  userId,
  list,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  userId: string;
  list?: Entity;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={list ? "A little fine-tuning." : "Give your next movie night a name."}
      description="All lists are public to the MovieFinder community."
    >
      <form
        key={list?.id ?? "new"}
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget),
            title = fieldText(d.get("title")),
            description = fieldText(d.get("description"));
          void send(
            list
              ? { type: "list.edit", listId: list.id, title, description }
              : { type: "list.create", title, description },
            userId,
          )
            .then(() => {
              setOpen(false);
              notify(list ? "List updated." : "A new collection, a world of possibilities.");
            })
            .catch(report);
        }}
      >
        <label>
          List name
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={list?.title}
            placeholder="Films that feel like a Sunday"
          />
        </label>
        <label>
          A few words
          <textarea
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={fieldText(list?.data.description ?? "")}
            placeholder="Set the mood. Tell us what belongs here."
          />
        </label>
        <Button type="submit">
          {list ? "Save changes" : "Create your list"}
          <ArrowUpRight size={17} />
        </Button>
      </form>
    </Sheet>
  );
}
export function ListDetail({ userId }: { userId: string }) {
  const { listId } = useParams({ strict: false }) as { listId: string },
    router = useRouter(),
    lists = useEntities("list"),
    entries = useListItems(listId),
    statuses = useViewerStatuses(),
    byId = useTitles(),
    invitations = useEntities("invitation"),
    members = useEntities("collaborator"),
    users = useEntities("user"),
    follows = useEntities("follow"),
    activities = useEntities("activity"),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState(false),
    [invite, setInvite] = useState(false),
    [add, setAdd] = useState(false),
    [hover, setHover] = useState(""),
    drag = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadSocial("list", listId, undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [listId]);
  const queryRows = useEntities("query"),
    nextPage = queryRows.find((q) => q.id === `social:list:${listId}`)?.data.nextCursor as
      | string
      | null
      | undefined;
  const list = lists.find((l) => l.id === listId),
    role = members.find((m) => m.data.listId === listId && m.data.userId === userId)?.data.role,
    editable = role === "owner" || role === "editor",
    owner = role === "owner",
    filtered = entries.filter(
      (i) =>
        !search ||
        byId.get(fieldText(i.data.titleId))?.title.toLowerCase().includes(search.toLowerCase()),
    ),
    collaborators = members.filter((m) => m.data.listId === listId),
    saved = follows.some((f) => f.data.targetId === listId);
  if (!list)
    return (
      <div className="standard-page">
        <Empty title="This list hasn’t arrived yet.">
          It may have been removed, or your connection is catching up.
        </Empty>
        <Link to="/lists">Explore other lists</Link>
      </div>
    );
  const move = (itemId: string, beforeId: string | null) =>
    void send({ type: "list.move", listId, itemId, beforeId }, userId).catch(report);
  return (
    <div className="standard-page list-detail">
      <Button variant="ghost" onClick={() => router.history.back()}>
        <ArrowLeft size={16} />
        Back to collections
      </Button>
      <header className="list-detail-heading">
        <span className="eyebrow">A LITTLE COLLECTION OF GOOD STORIES</span>
        <h1>{list.title}</h1>
        <p>{fieldText(list.data.description) || "Good taste, collected."}</p>
        <div className="list-metadata">
          <span>{entries.length} titles</span>
          <span>Public collection</span>
          <span className="live-pill">
            <i />
            Live collaboration
          </span>
        </div>
        <div className="list-actions">
          {editable && (
            <Button onClick={() => setAdd(true)}>
              <Plus size={16} />
              Add titles
            </Button>
          )}
          {owner && (
            <>
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil size={15} />
                Edit
              </Button>
              <Button variant="outline" onClick={() => setInvite(true)}>
                <UserPlus size={15} />
                Invite friends
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() =>
              void send({ type: "list.follow", listId, follow: !saved }, userId).catch(report)
            }
          >
            {saved ? <Check size={16} /> : <Bookmark size={16} />} {saved ? "Saved" : "Save list"}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void send({ type: "list.copy", listId }, userId)
                .then(() => notify("A copy is waiting in your collections."))
                .catch(report)
            }
          >
            <Copy size={16} />
            Make a copy
          </Button>
        </div>
      </header>
      <div className="list-body">
        <section>
          <div className="search-field small">
            <Search size={17} />
            <input
              aria-label="Search this list"
              placeholder="Find a title in this list…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filtered.length ? (
            <div className="list-entries">
              {filtered.map((entry, index) => {
                const e = byId.get(fieldText(entry.data.titleId));
                return (
                  <article
                    key={entry.id}
                    data-item-id={entry.id}
                    className={`list-entry ${hover === entry.id ? "drag-over" : ""}`}
                  >
                    <span className="entry-number">{fieldText(index + 1).padStart(2, "0")}</span>
                    {editable && (
                      <button
                        aria-label={`Drag to reorder ${e?.title ?? "title"}`}
                        className="drag-handle"
                        onPointerDown={(event) => {
                          drag.current = entry.id;
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                          if (!drag.current) return;
                          const target = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest("[data-item-id]")
                            ?.getAttribute("data-item-id");
                          setHover(target ?? "");
                        }}
                        onPointerUp={(event) => {
                          if (drag.current && hover && hover !== drag.current)
                            move(drag.current, hover);
                          drag.current = null;
                          setHover("");
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }}
                        onPointerCancel={() => {
                          drag.current = null;
                          setHover("");
                        }}
                      >
                        <GripVertical size={18} />
                      </button>
                    )}
                    <Link
                      to="/title/$id"
                      params={{ id: fieldText(entry.data.titleId) }}
                      className="entry-content"
                    >
                      <Poster entity={e} slot="thumb" />
                      <div>
                        <h3>{e?.title ?? "Title details arriving"}</h3>
                        <p>
                          {e?.year ?? "—"} · {e?.kind === "tv" ? "TV series" : "Film"}
                        </p>
                        <span className="entry-tags">
                          {statuses.get(entry.data.titleId as string)?.seen === true && (
                            <span>
                              <Eye size={10} />
                              Seen
                            </span>
                          )}
                          {["liked", "meh", "disliked"].includes(
                            fieldText(statuses.get(entry.data.titleId as string)?.sentiment),
                          ) && (
                            <span>
                              <Heart size={10} />
                              {fieldText(statuses.get(entry.data.titleId as string)?.sentiment)}
                            </span>
                          )}
                        </span>
                        {e?.overview && <small>{e.overview}</small>}
                      </div>
                    </Link>
                    {editable && (
                      <div className="entry-actions">
                        <button
                          aria-label={`Move ${e?.title} up`}
                          disabled={index === 0}
                          onClick={() => move(entry.id, entries[index - 1]?.id ?? null)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          aria-label={`Move ${e?.title} down`}
                          disabled={index === entries.length - 1}
                          onClick={() => move(entry.id, entries[index + 2]?.id ?? null)}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          aria-label={`Remove ${e?.title}`}
                          onClick={() =>
                            void send(
                              { type: "list.remove", listId, itemId: entry.id },
                              userId,
                            ).catch(report)
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              title={
                search ? "No matches in this collection." : "The opening credits are still rolling."
              }
            >
              {search ? "Try another title." : "Add the first film or series and set the mood."}
            </Empty>
          )}
        </section>
        <aside className="list-sidebar">
          <h3>Good company.</h3>
          <p>{collaborators.length} people making this collection.</p>
          {collaborators.map((m) => {
            const u = users.find((u) => u.id === m.data.userId);
            return (
              <div className="collaborator-row" key={m.id}>
                <Link to="/profile/$userId" params={{ userId: fieldText(m.data.userId) }}>
                  <span className="avatar">{u?.title.slice(0, 1) ?? "?"}</span>
                  <span>
                    {u?.title ?? "Movie lover"}
                    <small>{fieldText(m.data.role)}</small>
                  </span>
                </Link>
                {owner && m.data.role !== "owner" && (
                  <button
                    aria-label={`Remove ${u?.title} as collaborator`}
                    onClick={() =>
                      void send(
                        { type: "list.member.remove", listId, userId: fieldText(m.data.userId) },
                        userId,
                      ).catch(report)
                    }
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            );
          })}
          <h3 className="recent-title">The latest edits.</h3>
          {activities
            .filter((a) => a.data.targetId === listId)
            .slice(0, 8)
            .map((a) => (
              <p className="recent-edit" key={a.id}>
                {users.find((u) => u.id === a.data.userId)?.title ?? "Someone"} {a.title}
                <small>{new Date(fieldText(a.data.createdAt)).toLocaleDateString()}</small>
              </p>
            ))}
          {editable && (
            <p className="field-note">
              Drag a handle to reorder, or use the arrows. Every change is shared automatically.
            </p>
          )}
        </aside>
      </div>
      {nextPage && (
        <Button
          variant="outline"
          onClick={() => void loadSocial("list", listId, nextPage).catch(report)}
        >
          Load more titles
        </Button>
      )}
      <ListEditor open={edit} setOpen={setEdit} userId={userId} list={list} />
      <Sheet
        open={invite}
        onOpenChange={setInvite}
        title="Good films. Good company."
        description="Invite someone to help shape this collection."
      >
        <div className="sheet-body list-picker">
          {invitations
            .filter((i) => i.data.listId === listId && i.data.state === "pending")
            .map((inv) => (
              <div className="collaborator-row" key={inv.id}>
                <span>
                  {users.find((u) => u.id === inv.data.userId)?.title ?? "A movie lover"}
                  <small>Invitation pending</small>
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    void send(
                      { type: "list.member.remove", listId, userId: fieldText(inv.data.userId) },
                      userId,
                    ).catch(report)
                  }
                >
                  Cancel invitation
                </Button>
              </div>
            ))}
          {users
            .filter(
              (u) =>
                !collaborators.some((m) => m.data.userId === u.id) &&
                !invitations.some(
                  (i) =>
                    i.data.listId === listId &&
                    i.data.userId === u.id &&
                    i.data.state === "pending",
                ),
            )
            .map((u) => (
              <button
                key={u.id}
                onClick={() =>
                  void send({ type: "list.invite", listId, userId: u.id }, userId)
                    .then(() => {
                      notify(`Invitation sent to ${u.title}.`);
                      setInvite(false);
                    })
                    .catch(report)
                }
              >
                <span className="avatar">{u.title[0]}</span>
                <span>
                  {u.title}
                  <small>@{fieldText(u.data.username ?? "movie-lover")}</small>
                </span>
                <UserPlus size={17} />
              </button>
            ))}
        </div>
      </Sheet>
      <AddTitles
        open={add}
        setOpen={setAdd}
        listId={listId}
        userId={userId}
        existing={entries.map((e) => fieldText(e.data.titleId))}
      />
    </div>
  );
}
function XIcon() {
  return <Trash2 size={14} />;
}
function AddTitles({
  open,
  setOpen,
  listId,
  userId,
  existing,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  listId: string;
  userId: string;
  existing: string[];
}) {
  const movies = useEntities("movie"),
    tv = useEntities("tv"),
    [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    let unsubscribe: undefined | (() => void);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = feedParams.parse({ q });
      void discover(params, controller.signal)
        .then((id) => {
          if (!controller.signal.aborted) unsubscribe = subscribeQuery(id, params);
        })
        .catch((error) => {
          if (!controller.signal.aborted) report(error);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
      unsubscribe?.();
    };
  }, [q, open]);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="One more for the list."
      description="Search films and series to find the perfect addition."
    >
      <div className="sheet-body list-picker">
        <label>
          Find a title
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What belongs here?"
          />
        </label>
        {[...movies, ...tv]
          .filter((e) => e.title.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 30)
          .map((e) => (
            <button
              key={e.id}
              disabled={existing.includes(e.id)}
              onClick={() =>
                void send({ type: "list.add", listId, titleId: e.id }, userId).catch(report)
              }
            >
              <span>
                {e.title}
                <small>
                  {e.year} · {e.kind === "tv" ? "Series" : "Film"}
                </small>
              </span>
              {existing.includes(e.id) ? <Check size={17} /> : <Plus size={17} />}
            </button>
          ))}
        <Button variant="outline" asChild>
          <Link to="/search">
            Explore the whole catalog
            <ArrowUpRight size={15} />
          </Link>
        </Button>
      </div>
    </Sheet>
  );
}
