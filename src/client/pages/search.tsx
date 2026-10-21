import { bindNavigation } from "../telemetry";
import { fieldText } from "../../shared/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { Search, ArrowUpRight, Users, Bookmark } from "lucide-react";
import { feedParams, stableSerialize, type Entity } from "../../shared/contracts";
import { discover, subscribeQuery, useEntities, report, loadSocial } from "../state";
import { TitleCard, PageHeading, Empty, ShowMore, usePaging } from "../components/common";
const noIds: string[] = [];
export function SearchPage() {
  const search = useSearch({ strict: false }),
    navigate = useNavigate(),
    initial = fieldText(search.q ?? ""),
    [input, setInput] = useState(initial),
    submitted = useRef(initial.trim()),
    query = initial.trim(),
    movies = useEntities("movie"),
    tv = useEntities("tv"),
    people = useEntities("person"),
    users = useEntities("user"),
    lists = useEntities("list"),
    queries = useEntities("query");
  useEffect(() => {
    if (input.trim() === initial.trim()) return;
    const timer = setTimeout(() => {
      submitted.current = input.trim();
      void navigate({ to: "/search", search: input ? { q: input } : {}, replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, initial]);
  useEffect(() => {
    // A completed request must not overwrite text entered while it was preparing.
    if (initial.trim() !== submitted.current) setInput(initial);
  }, [initial]);
  useEffect(() => {
    if (!query) return;
    const params = feedParams.parse({ q: query }),
      abort = new AbortController();
    bindNavigation(abort.signal, window.location.href);
    void loadSocial("search", query, undefined, abort.signal).catch((error) => {
      if (!abort.signal.aborted) report(error);
    });
    let unsub: undefined | (() => void);
    void discover(params, abort.signal)
      .then((id) => {
        if (!abort.signal.aborted) {
          unsub = subscribeQuery(id, params);
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) report(error);
      });
    return () => {
      abort.abort();
      unsub?.();
    };
  }, [query]);
  const queryKey = useMemo(() => stableSerialize(feedParams.parse({ q: query })), [query]);
  const meta = queries.find(
      (q) => q.id.startsWith("discover:") && stableSerialize(q.data.params) === queryKey,
    ),
    remoteIds = (meta?.data.ids as string[] | undefined) ?? noIds,
    paging = usePaging(query, 48);
  // Provider-ranked results first, then other cached matches. Computed once per change.
  const titles = useMemo(() => {
    if (!query) return [];
    const needle = query.toLowerCase(),
      remote = new Set(remoteIds),
      all = new Map([...movies, ...tv, ...people].map((e) => [e.id, e])),
      ranked = remoteIds.map((id) => all.get(id)).filter((e): e is Entity => !!e);
    for (const e of all.values())
      if (!remote.has(e.id) && e.title.toLowerCase().includes(needle)) ranked.push(e);
    return ranked;
  }, [query, remoteIds, movies, tv, people]);
  const matches = (e: Entity) => e.title.toLowerCase().includes(query.toLowerCase()),
    filmsAndSeries = useMemo(() => titles.filter((t) => t.kind !== "person"), [titles]),
    personResults = useMemo(() => titles.filter((e) => e.kind === "person"), [titles]),
    userResults = users.filter(matches),
    listResults = lists.filter(matches);
  return (
    <div className="standard-page">
      <PageHeading eyebrow="FOLLOW YOUR CURIOSITY" title="What are you in the mood for?" />
      <div className="search-field">
        <Search size={22} />
        <input
          aria-label="Search movies, series, people, and lists"
          maxLength={200}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A film, a series, a person, a feeling…"
          autoComplete="off"
          autoFocus
        />
      </div>
      {!query ? (
        <div className="search-start">
          <span>✦</span>
          <h2>Start with a little curiosity.</h2>
          <p>Discover films, find your people, or borrow someone’s very good taste.</p>
          <div className="suggested-searches">
            {["Studio Ghibli", "Christopher Nolan", "Severance", "Wong Kar-wai"].map((q) => (
              <button className="chip" key={q} onClick={() => setInput(q)}>
                {q}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="search-summary">
            Exploring “{query}”
            {meta && (meta.data.coverage as { state: string }).state !== "complete" && (
              <span> · More results may arrive</span>
            )}
          </div>
          {filmsAndSeries.length > 0 && (
            <section className="detail-section">
              <h2>Films & series</h2>
              <div className="title-grid">
                {filmsAndSeries.slice(0, paging.shown).map((e) => (
                  <TitleCard key={e.id} entity={e} />
                ))}
              </div>
              <ShowMore total={filmsAndSeries.length} paging={paging} />
            </section>
          )}
          {personResults.length > 0 && (
            <section className="detail-section">
              <h2>Behind the stories</h2>
              <div className="title-grid">
                {personResults.map((e) => (
                  <TitleCard key={e.id} entity={e} />
                ))}
              </div>
            </section>
          )}
          {userResults.length > 0 && (
            <section className="detail-section">
              <h2>People with good taste</h2>
              <div className="social-results">
                {userResults.map((u) => (
                  <Link key={u.id} to="/profile/$userId" params={{ userId: u.id }}>
                    <Users />
                    <div>
                      <strong>{u.title}</strong>
                      <small>@{fieldText(u.data.username ?? "movie-lover")}</small>
                    </div>
                    <ArrowUpRight />
                  </Link>
                ))}
              </div>
            </section>
          )}
          {listResults.length > 0 && (
            <section className="detail-section">
              <h2>Lists to get lost in</h2>
              <div className="social-results">
                {listResults.map((l) => (
                  <Link key={l.id} to="/lists/$listId" params={{ listId: l.id }}>
                    <Bookmark />
                    <div>
                      <strong>{l.title}</strong>
                      <small>
                        {fieldText(l.data.description ?? "A little collection of stories.")}
                      </small>
                    </div>
                    <ArrowUpRight />
                  </Link>
                ))}
              </div>
            </section>
          )}
          {!titles.length && !userResults.length && !listResults.length && (
            <Empty title="A little further off the beaten path.">
              No cached matches yet. Try another title while the catalog search finishes.
            </Empty>
          )}
        </>
      )}
    </div>
  );
}
