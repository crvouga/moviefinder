import { loadSocial } from "../state";
import { fieldText } from "../../shared/contracts";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Pencil, ArrowUpRight, LogOut, Check, UserPlus, Bookmark } from "lucide-react";
import { authClient, useEntities, send, report, encodeParams, stopSync } from "../state";
import type { FeedParams } from "../../shared/contracts";
import { PageHeading, Empty, TitleCard, ShowMore, usePaging } from "../components/common";
import { useTitles, useUsers } from "../components/viewer";
import { ListCard } from "./lists";
import { Button } from "../components/ui/button";
import { Sheet } from "../components/ui/dialog";
export function ActivityPage({ userId }: { userId: string }) {
  const activities = useEntities("activity"),
    users = useUsers(),
    lists = useEntities("list"),
    titles = useTitles(),
    invitations = useEntities("invitation"),
    pending = invitations.filter((i) => i.data.userId === userId && i.data.state === "pending"),
    paging = usePaging("activity", 40),
    listsById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]),
    sorted = useMemo(
      () =>
        [...activities].sort((a, b) =>
          fieldText(b.data.createdAt).localeCompare(fieldText(a.data.createdAt)),
        ),
      [activities],
    );
  return (
    <div className="standard-page activity-page">
      <PageHeading eyebrow="A SHARED LOVE OF STORIES" title="In good company." />
      {pending.length > 0 && (
        <section className="invitation-section">
          <h2>You’re on the list.</h2>
          {pending.map((inv) => (
            <div className="invitation" key={inv.id}>
              <UserPlus />
              <div>
                <strong>
                  {users.get(fieldText(inv.data.invitedBy))?.title ?? "A friend"} invited you to
                  collaborate
                </strong>
                <p>{listsById.get(fieldText(inv.data.listId))?.title ?? "A shared collection"}</p>
              </div>
              <Button
                size="small"
                onClick={() =>
                  void send({ type: "invitation.accept", invitationId: inv.id }, userId).catch(
                    report,
                  )
                }
              >
                Accept
              </Button>
              <Button
                size="small"
                variant="ghost"
                onClick={() =>
                  void send({ type: "invitation.decline", invitationId: inv.id }, userId).catch(
                    report,
                  )
                }
              >
                Decline
              </Button>
            </div>
          ))}
        </section>
      )}
      {activities.length ? (
        <div className="activity-feed">
          {sorted.slice(0, paging.shown).map((a) => {
            const u = users.get(fieldText(a.data.userId)),
              targetId = fieldText(a.data.targetId),
              target = titles.get(targetId) ?? listsById.get(targetId);
            return (
              <article key={a.id}>
                <Link
                  to="/profile/$userId"
                  params={{ userId: fieldText(a.data.userId) }}
                  className="avatar"
                >
                  {u?.title[0] ?? "?"}
                </Link>
                <div>
                  <p>
                    <Link to="/profile/$userId" params={{ userId: fieldText(a.data.userId) }}>
                      <strong>{u?.title ?? "A movie lover"}</strong>
                    </Link>{" "}
                    {a.title}
                  </p>
                  {target && (
                    <Link
                      to={target.kind === "list" ? "/lists/$listId" : "/title/$id"}
                      params={target.kind === "list" ? { listId: targetId } : { id: targetId }}
                      className="activity-target"
                    >
                      {target.title}
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                  <small>
                    {new Date(fieldText(a.data.createdAt)).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </article>
            );
          })}
          <ShowMore total={sorted.length} paging={paging} />
        </div>
      ) : (
        <Empty title="The conversation starts with you.">
          Share a take, start a collection, or invite a friend. Your community’s stories will show
          up here.
        </Empty>
      )}
    </div>
  );
}
export function ProfilePage({ currentUserId }: { currentUserId: string }) {
  const params = useParams({ strict: false }) as { userId?: string },
    userId = params.userId ?? currentUserId,
    own = userId === currentUserId,
    users = useUsers(),
    statuses = useEntities("status"),
    lists = useEntities("list"),
    byId = useTitles(),
    feeds = useEntities("feed"),
    follows = useEntities("follow"),
    [edit, setEdit] = useState(false),
    [tab, setTab] = useState("liked");
  const user = users.get(userId),
    tags = statuses.filter((s) => s.data.userId === userId),
    titles = tags
      .filter((s) => (tab === "seen" ? s.data.seen : s.data.sentiment === tab))
      .map((s) => byId.get(fieldText(s.data.titleId)))
      .filter((e) => !!e),
    paging = usePaging(`${userId}|${tab}`),
    ownedLists = lists.filter((l) => l.data.ownerId === userId),
    followed = follows.some((f) => f.data.targetId === userId);
  const queryRows = useEntities("query"),
    nextPage = queryRows.find((q) => q.id === `social:profile:${userId}`)?.data.nextCursor as
      | string
      | null
      | undefined;
  useEffect(() => {
    const controller = new AbortController();
    void loadSocial("profile", userId, undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [userId]);
  return (
    <div className="standard-page profile-page">
      <header className="profile-header">
        <div className="profile-avatar">
          {user?.poster ? <img src={user.poster} alt="" /> : (user?.title[0] ?? "M")}
        </div>
        <div>
          <span className="eyebrow">A LIFE IN GOOD STORIES</span>
          <h1>{user?.title ?? "Movie lover"}</h1>
          <p>@{fieldText(user?.data.username ?? "movie-lover")}</p>
          <p>{fieldText(user?.data.bio ?? "Your taste tells a story.")}</p>
        </div>
        {own ? (
          <Button variant="outline" disabled={!user} onClick={() => setEdit(true)}>
            <Pencil size={15} />
            Edit profile
          </Button>
        ) : (
          <Button
            variant={followed ? "outline" : "default"}
            onClick={() =>
              void send({ type: "user.follow", userId, follow: !followed }, currentUserId).catch(
                report,
              )
            }
          >
            {followed ? <Check size={15} /> : <UserPlus size={15} />}{" "}
            {followed ? "Following" : "Follow"}
          </Button>
        )}
      </header>
      <div className="profile-stats">
        <div>
          <strong>{tags.filter((s) => s.data.seen).length}</strong>
          <span>Stories seen</span>
        </div>
        <div>
          <strong>{tags.filter((s) => s.data.sentiment === "liked").length}</strong>
          <span>All-time loves</span>
        </div>
        <div>
          <strong>{ownedLists.length}</strong>
          <span>Collections</span>
        </div>
      </div>
      <div className="section-tabs">
        {[
          ["liked", "Loved it"],
          ["seen", "Seen it"],
          ["meh", "It was okay"],
          ["disliked", "Not for me"],
          ["lists", "Collections"],
          ...(own ? [["feeds", "Saved feeds"]] : []),
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key!)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "lists" ? (
        ownedLists.length ? (
          <div className="list-grid">
            {ownedLists.map((l) => (
              <ListCard key={l.id} list={l} />
            ))}
          </div>
        ) : (
          <Empty title="A collection of possibilities.">New lists will appear here.</Empty>
        )
      ) : tab === "feeds" ? (
        <div className="social-results">
          {feeds
            .filter((f) => f.data.userId === userId)
            .map((f) => (
              <Link key={f.id} to="/" search={encodeParams(f.data.params as FeedParams)}>
                <Bookmark />
                <strong>{f.title}</strong>
                <ArrowUpRight />
              </Link>
            ))}
          {!feeds.length && (
            <Empty title="Find your kind of feed.">
              Save a set of filters from Discover and come back to it anytime.
            </Empty>
          )}
        </div>
      ) : titles.length ? (
        <div className="title-grid">
          {titles.slice(0, paging.shown).map((e) => (
            <TitleCard key={e.id} entity={e} />
          ))}
        </div>
      ) : (
        <Empty title="Good taste takes a little exploring.">
          A few taps in Discover and this space starts telling your story.
        </Empty>
      )}
      <ShowMore total={titles.length} paging={paging} />
      {nextPage && (
        <Button
          variant="outline"
          onClick={() => void loadSocial("profile", userId, nextPage).catch(report)}
        >
          More stories
        </Button>
      )}
      {own && (
        <Button
          className="logout"
          variant="ghost"
          onClick={() =>
            void authClient
              .signOut()
              .then(() => {
                stopSync();
                location.assign("/auth");
              })
              .catch(report)
          }
        >
          <LogOut size={16} />
          Sign out
        </Button>
      )}
      <section className="about-credits">
        <h2>For the love of a good story.</h2>
        <p>MovieFinder is a place to discover, collect, and share the stories you love.</p>
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          <img
            src="/tmdb-logo.svg"
            alt="The Movie Database"
            width="65"
            height="47"
            loading="lazy"
          />
        </a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p>Streaming availability is provided by JustWatch through TMDB.</p>
      </section>
      <Sheet
        open={edit}
        onOpenChange={setEdit}
        title="Make yourself at home."
        description="Your profile is public to other MovieFinder members."
      >
        <form
          className="sheet-body"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void send(
              {
                type: "profile",
                name: fieldText(d.get("name")),
                username: fieldText(d.get("username")),
                bio: fieldText(d.get("bio")),
                image: fieldText(d.get("image")),
              },
              currentUserId,
            )
              .then(() => setEdit(false))
              .catch(report);
          }}
        >
          <label>
            Display name
            <input name="name" required maxLength={100} defaultValue={user?.title} />
          </label>
          <label>
            Username
            <input
              name="username"
              required
              pattern="[a-zA-Z0-9_]{3,30}"
              defaultValue={fieldText(user?.data.username ?? "")}
            />
          </label>
          <label>
            About you
            <textarea
              name="bio"
              rows={3}
              maxLength={500}
              defaultValue={fieldText(user?.data.bio ?? "")}
              placeholder="Your favorite genre. Your most controversial take."
            />
          </label>
          <label>
            Avatar URL
            <input
              name="image"
              type="url"
              placeholder="https://…"
              defaultValue={fieldText(user?.data.image ?? "")}
            />
          </label>
          <Button type="submit">
            Save profile
            <Check size={17} />
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
