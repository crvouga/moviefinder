import { bindNavigation, currentNavigationContext, markNavigationContent } from "../telemetry";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Star, Play, ArrowUpRight, Calendar, Clock } from "lucide-react";
import { useEntity, useEntities, loadEntity, subscribeEntity, getEntity, report } from "../state";
import { Poster, Tags, TitleCard, External, ShowMore, usePaging } from "../components/common";
import { Image } from "../components/image";
import { entityImages } from "../images";
import { Button } from "../components/ui/button";
import { useScreenReady } from "../components/screen";
import type { Entity } from "../../shared/contracts";
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    : [];
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
// Commit a lightweight destination before mounting its potentially large live graph. The
// second frame schedules interruptible enrichment, so even a warm 300-credit page opens first.
export function DetailPage({ userId }: { userId: string }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const router = useRouter();
  const ready = useScreenReady();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Even a fast response can synchronously commit a large graph. Start the destination read
  // after its preview has had a rendering opportunity, so that work cannot delay opening it.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    bindNavigation(controller.signal, window.location.href);
    setFailed(false);
    void loadEntity(id, controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        setFailed(true);
        report(error);
      }
    });
    const unsubscribe = subscribeEntity(id);
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [id, attempt, ready]);
  if (ready)
    return (
      <DetailContent
        userId={userId}
        failed={failed}
        retry={() => setAttempt((value) => value + 1)}
      />
    );
  const entity = getEntity(id);
  return (
    <div className="detail-page" data-title-id={id}>
      <Button
        className="back-button"
        variant="ghost"
        onClick={() =>
          router.history.length > 1 ? router.history.back() : router.navigate({ to: "/" })
        }
      >
        <ArrowLeft size={17} /> Back to the good stuff
      </Button>
      <section className={entity ? "detail-hero" : "detail-skeleton"} aria-busy="true">
        {entity ? (
          <Poster entity={entity} slot="hero" priority />
        ) : (
          <div className="skeleton-poster" />
        )}
        <div className="detail-intro">
          <h1>
            {entity?.title ?? (id.startsWith("tmdb:person:") ? "Person details" : "Title details")}
          </h1>
          {entity?.overview ? (
            <p className="synopsis">{entity.overview}</p>
          ) : (
            <div className="skeleton-line wide" />
          )}
        </div>
      </section>
    </div>
  );
}
function DetailContent({
  userId,
  failed,
  retry,
}: {
  userId: string;
  failed: boolean;
  retry: () => void;
}) {
  const [filmographyTab, setFilmographyTab] = useState("all");
  const { id } = useParams({ strict: false }) as { id: string },
    entity = useEntity(id) ?? getEntity(id),
    router = useRouter(),
    credits = useEntities("credit", [
      ...ids(entity?.data.credits),
      ...ids(entity?.data.filmographyCredits),
    ]),
    people = useEntities(
      "person",
      credits.map((credit) => text(credit.data.personId)),
    ),
    genres = useEntities("genre", entity?.genres ?? []),
    movies = useEntities("movie", entity?.related ?? []),
    series = useEntities("tv", entity?.related ?? []),
    seasons = useEntities("season", ids(entity?.data.seasons)),
    episodes = useEntities("episode", ids(entity?.data.episodes));
  // Index each collection once per change; the page reads these by id many times per render.
  const byId = useMemo(
      () =>
        new Map([...people, ...movies, ...series, ...seasons, ...episodes].map((e) => [e.id, e])),
      [people, movies, series, seasons, episodes],
    ),
    creditsById = useMemo(() => new Map(credits.map((c) => [c.id, c])), [credits]),
    genreTitles = useMemo(() => new Map(genres.map((g) => [g.id, g.title])), [genres]);
  // Department per filmography title, so each tab filters in one pass.
  const departments = useMemo(() => {
    const own = new Set(ids(entity?.data.filmographyCredits)),
      map = new Map<string, Set<string>>();
    for (const c of credits)
      if (own.has(c.id)) {
        const title = text(c.data.titleId);
        map.set(title, (map.get(title) ?? new Set()).add(text(c.data.department)));
      }
    return map;
  }, [credits, entity?.data.filmographyCredits]);
  const paging = usePaging(`${id}|${filmographyTab}`, 24);
  const visibleReady =
    !!entity &&
    entity.data.summary !== true &&
    entity.data.graphVersion !== undefined &&
    ids(entity.data.credits)
      .slice(0, 8)
      .every((key) => {
        const credit = creditsById.get(key);
        return !!credit && !!byId.get(text(credit.data.personId));
      }) &&
    ids(entity.data.seasons)
      .slice(0, 4)
      .every((key) => byId.has(key)) &&
    ids(entity.data.episodes)
      .slice(0, 4)
      .every((key) => byId.has(key)) &&
    [
      ...new Set(
        Object.values((entity.data.relations ?? {}) as Record<string, unknown>).flatMap(ids),
      ),
    ]
      .slice(0, 8)
      .every((key) => byId.has(key));
  const context = currentNavigationContext();
  useEffect(() => {
    if (!visibleReady) return;
    const frame = requestAnimationFrame(() => markNavigationContent(context));
    return () => cancelAnimationFrame(frame);
  }, [visibleReady, context?.traceId]);
  if (!entity)
    return (
      <div className="detail-page" data-title-id={id}>
        <Button variant="ghost" onClick={() => router.history.back()}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <div className="detail-skeleton" aria-busy={!failed}>
          <div className="skeleton-poster" />
          <div>
            <h1>{id.startsWith("tmdb:person:") ? "Person details" : "Title details"}</h1>
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <p role="status">
              {failed
                ? "These details couldn’t be fetched. You can try again."
                : "Gathering the story, cast, and little details. They’ll appear here as they arrive."}
            </p>
            {failed && <Button onClick={retry}>Try again</Button>}
          </div>
        </div>
      </div>
    );
  const person = entity.kind === "person";
  const cast = ((entity.data.credits as string[]) ?? [])
      .map((cid) => creditsById.get(cid))
      .filter((c): c is Entity => !!c),
    relations = (entity.data.relations as Record<string, string[]>) ?? {},
    related = [
      ...new Set([
        ...ids(relations.recommendations),
        ...ids(relations.similar),
        ...ids(relations.filmography),
        ...ids(relations.knownFor),
      ]),
    ]
      .map((i) => byId.get(i))
      .filter((e): e is Entity => !!e);
  const visibleRelated = related.filter(
    (e) =>
      !person ||
      filmographyTab === "all" ||
      [...(departments.get(e.id) ?? [])].some((d) =>
        filmographyTab === "other"
          ? !["Acting", "Directing", "Writing"].includes(d)
          : d === filmographyTab,
      ),
  );
  return (
    <div
      className="detail-page"
      data-title-id={id}
      data-content-ready={visibleReady ? "true" : "false"}
      data-graph-scope={
        entity.data.graphScope === "viewport"
          ? "viewport"
          : entity.data.summary
            ? "summary"
            : "full"
      }
    >
      {entity.backdrop && (
        <div className="detail-backdrop">
          <Image images={entityImages(entity)} slot="backdrop" priority />
        </div>
      )}
      <Button
        className="back-button"
        variant="ghost"
        onClick={() =>
          router.history.length > 1 ? router.history.back() : router.navigate({ to: "/" })
        }
      >
        <ArrowLeft size={17} /> Back to the good stuff
      </Button>
      <section className="detail-hero">
        <Poster entity={entity} slot="hero" priority />
        <div className="detail-intro">
          <span className="eyebrow">
            {person
              ? "THE PEOPLE BEHIND THE STORIES"
              : entity.kind === "tv"
                ? "A STORY WORTH SETTLING INTO"
                : entity.kind === "season"
                  ? "ONE CHAPTER AT A TIME"
                  : entity.kind === "episode"
                    ? "THE NEXT CHAPTER"
                    : "YOUR NEXT GREAT WATCH"}
          </span>
          <h1>{entity.title}</h1>
          {text(entity.data.originalTitle) && entity.data.originalTitle !== entity.title && (
            <p className="original-title">{text(entity.data.originalTitle)}</p>
          )}
          <div className="detail-facts">
            {entity.year && (
              <span>
                <Calendar size={15} />
                {entity.year}
              </span>
            )}
            {!!entity.rating && (
              <span className="rating">
                <Star size={15} fill="currentColor" />
                {entity.rating.toFixed(1)}{" "}
                <small>({Number(entity.data.voteCount ?? 0).toLocaleString()} votes)</small>
              </span>
            )}
            {!!entity.data.runtime && (
              <span>
                <Clock size={15} />
                {Array.isArray(entity.data.runtime)
                  ? entity.data.runtime.join("–")
                  : text(entity.data.runtime)}{" "}
                min
              </span>
            )}
            <span>
              {person
                ? text(entity.data.department)
                : entity.kind === "tv"
                  ? "TV series"
                  : entity.kind === "movie"
                    ? "Film"
                    : entity.kind}
            </span>
          </div>
          <div className="detail-genres">
            {entity.genres?.map((g) => (
              <Link key={g} to="/" search={{ genres: g.split(":").at(-1) }} className="chip">
                {genreTitles.get(g) ?? "Explore genre"}
              </Link>
            ))}
          </div>
          {text(entity.data.tagline) && <p className="tagline">“{text(entity.data.tagline)}”</p>}
          <p className="synopsis">
            {entity.overview || "A synopsis hasn’t been provided for this story yet."}
          </p>
          {["movie", "tv"].includes(entity.kind) && <Tags entity={entity} userId={userId} />}
          <div className="detail-links">
            {entity.kind === "season" && (
              <Link to="/title/$id" params={{ id: id.split(":season:")[0]! }}>
                View series <ArrowUpRight size={14} />
              </Link>
            )}
            {entity.kind === "episode" && (
              <Link to="/title/$id" params={{ id: id.split(":episode:")[0]! }}>
                View season <ArrowUpRight size={14} />
              </Link>
            )}
            {text(entity.data.imdbId) && (
              <External
                href={`https://www.imdb.com/${person ? "name" : "title"}/${text(entity.data.imdbId)}`}
              >
                IMDb
              </External>
            )}
            {text(entity.data.homepage).startsWith("https://") && (
              <External href={text(entity.data.homepage)}>Official website</External>
            )}
          </div>
        </div>
      </section>
      {(entity.data.graphScope === "viewport" || entity.data.summary === true) && (
        <p className="muted" role="status">
          {failed
            ? "Some details couldn’t be fetched."
            : "More details will appear here as they arrive."}
          {failed && (
            <Button variant="ghost" onClick={retry}>
              Try again
            </Button>
          )}
        </p>
      )}
      {records(entity.data.videos).length > 0 && (
        <section className="detail-section">
          <h2>Get a little taste.</h2>
          <div className="video-links">
            {records(entity.data.videos)
              .slice(0, 6)
              .map((v) => (
                <External
                  key={text(v.key)}
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(text(v.key))}`}
                >
                  <Play size={17} />
                  {text(v.name)}
                </External>
              ))}
          </div>
        </section>
      )}
      {records(entity.data.creators).length > 0 && (
        <section className="detail-section">
          <h2>The minds behind it.</h2>
          <div className="detail-links">
            {records(entity.data.creators).map((creator) => (
              <Link
                key={text(creator.id)}
                to="/title/$id"
                params={{ id: `tmdb:person:${text(creator.id)}` }}
              >
                {text(creator.name)}
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {cast.length > 0 && (
        <section className="detail-section">
          <div className="section-title">
            <h2>The people who make it.</h2>
            <span>{cast.length} credits</span>
          </div>
          <div className="cast-row">
            {cast.map((credit) => {
              const p = byId.get(text(credit.data.personId));
              return p ? (
                <Link key={credit.id} to="/title/$id" params={{ id: p.id }} className="person-card">
                  <Poster entity={p} slot="thumb" />
                  <h3>{p.title}</h3>
                  <p>{credit.title || "Cast & crew"}</p>
                </Link>
              ) : null;
            })}
          </div>
        </section>
      )}
      {ids(entity.data.seasons).length > 0 && (
        <section className="detail-section">
          <h2>Stay for another season.</h2>
          <div className="season-grid">
            {ids(entity.data.seasons).map((sid) => {
              const s = byId.get(sid);
              return (
                <Link key={sid} to="/title/$id" params={{ id: sid }} className="season-card">
                  <Poster entity={s} slot="thumb" />
                  <div>
                    <h3>{s?.title ?? "Season"}</h3>
                    <p>{s?.year ?? "Air date unavailable"}</p>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
              );
            })}
          </div>
        </section>
      )}
      {ids(entity.data.episodes).length > 0 && (
        <section className="detail-section">
          <h2>One more episode.</h2>
          <div className="episode-list">
            {ids(entity.data.episodes).map((eid) => {
              const e = byId.get(eid);
              return (
                <Link key={eid} to="/title/$id" params={{ id: eid }}>
                  <span className="episode-number">
                    {text(e?.data.episodeNumber).padStart(2, "0")}
                  </span>
                  <Poster entity={e} slot="still" />
                  <div>
                    <h3>{e?.title ?? "Episode"}</h3>
                    <small>{text(e?.data.releaseDate) || "Air date unavailable"}</small>
                    <p>{e?.overview || "Episode description unavailable."}</p>
                  </div>
                  <ArrowUpRight size={17} />
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <section className="detail-section">
        <h2>{person ? "A little more about them." : "The little details."}</h2>
        <dl className="metadata-grid">
          {(person
            ? [
                ["Born", entity.data.birthday],
                ["Died", entity.data.deathday],
                ["From", entity.data.birthplace],
                ["Known for", entity.data.department],
              ]
            : [
                ["Status", entity.data.status],
                ["Original language", entity.data.language],
                ["Released / first aired", entity.data.releaseDate],
                ["Latest air date", entity.data.lastAirDate],
                ["Seasons", entity.data.numberOfSeasons],
                ["Episodes", entity.data.numberOfEpisodes],
                ["Popularity", entity.popularity],
                [
                  "Countries",
                  records(entity.data.countries)
                    .map((c) => text(c.name))
                    .join(", ") || ids(entity.data.countries).join(", "),
                ],
                [
                  "Production",
                  records(entity.data.productionCompanies)
                    .map((c) => text(c.name))
                    .join(", "),
                ],
                [
                  "Networks",
                  records(entity.data.networks)
                    .map((c) => text(c.name))
                    .join(", "),
                ],
                [
                  "Created by",
                  records(entity.data.creators)
                    .map((c) => text(c.name))
                    .join(", "),
                ],
              ]
          )
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([label, value]) => (
              <div key={text(label)}>
                <dt>{text(label)}</dt>
                <dd>{text(value)}</dd>
              </div>
            ))}
        </dl>
        {!person && records(entity.data.keywords).length > 0 && (
          <div className="keyword-row">
            {records(entity.data.keywords).map((k) => (
              <Link key={text(k.id)} to="/" search={{ keywords: text(k.id) }} className="chip">
                {text(k.name)}
              </Link>
            ))}
          </div>
        )}
        {!!entity.data.collection && (
          <Link
            to="/search"
            search={{ q: text((entity.data.collection as Record<string, unknown>).name) }}
            className="external-link"
          >
            Explore {text((entity.data.collection as Record<string, unknown>).name)}
            <ArrowUpRight size={15} />
          </Link>
        )}
      </section>
      {!person && !!entity.data.watchProviders && <Providers value={entity.data.watchProviders} />}
      {related.length > 0 && (
        <section className="detail-section">
          <h2>{person ? "A career in stories." : "If this is your kind of thing."}</h2>
          {person && (
            <p className="muted">
              Acting, directing, writing, and crew credits from their filmography.
            </p>
          )}
          {person && (
            <div className="section-tabs">
              {[
                ["all", "All credits"],
                ["Acting", "Acting"],
                ["Directing", "Directing"],
                ["Writing", "Writing"],
                ["other", "Other crew"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filmographyTab === key ? "active" : ""}
                  onClick={() => setFilmographyTab(key!)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="title-grid">
            {visibleRelated.slice(0, paging.shown).map((e) => (
              <TitleCard key={e.id} entity={e} />
            ))}
          </div>
          <ShowMore total={visibleRelated.length} paging={paging} />
        </section>
      )}
      <p className="tmdb-credit">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </div>
  );
}
function Providers({ value }: { value: unknown }) {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {},
    results = root.results as Record<string, Record<string, unknown>> | undefined,
    region = results?.US,
    providers = records(region?.flatrate);
  return (
    <section className="detail-section">
      <h2>Make a night of it.</h2>
      {providers.length ? (
        <>
          <p className="muted">
            Subscription streaming in the US · availability by JustWatch via TMDB
          </p>
          <div className="provider-row">
            {providers.map((p) => (
              <span key={text(p.provider_id)}>{text(p.provider_name)}</span>
            ))}
          </div>
          {text(region?.link).startsWith("https://") && (
            <External href={text(region?.link)}>Check current availability</External>
          )}
        </>
      ) : (
        <p className="muted">Streaming availability hasn’t been provided for your region.</p>
      )}
    </section>
  );
}
