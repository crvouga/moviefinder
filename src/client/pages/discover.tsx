import { preloadTitles } from "../preloading";
import { movieGenreIds, tvGenreIds } from "../../shared/genres";
import { localMatch } from "../../shared/filters";
import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard, Mousewheel, Virtual, A11y } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import {
  SlidersHorizontal,
  ChevronDown,
  ArrowUpRight,
  Star,
  Bookmark,
  ArrowDown,
  Sparkles,
} from "lucide-react";
import {
  feedParams,
  stableSerialize,
  type FeedParams,
  type Coverage,
  type Entity,
} from "../../shared/contracts";
import {
  useEntities,
  discover,
  subscribeQuery,
  encodeParams,
  send,
  report,
  notify,
} from "../state";
import { Poster, Tags, PageHeading, Empty } from "../components/common";
import { Button } from "../components/ui/button";
import { Sheet } from "../components/ui/dialog";
const genres = [
  [28, "Action"],
  [12, "Adventure"],
  [16, "Animation"],
  [35, "Comedy"],
  [80, "Crime"],
  [99, "Documentary"],
  [18, "Drama"],
  [10751, "Family"],
  [14, "Fantasy"],
  [36, "History"],
  [27, "Horror"],
  [10402, "Music"],
  [9648, "Mystery"],
  [10749, "Romance"],
  [878, "Sci-Fi"],
  [53, "Thriller"],
  [10752, "War"],
  [37, "Western"],
  [10765, "Sci-Fi & Fantasy"],
  [10759, "Action & Adventure"],
  [10762, "Kids"],
  [10763, "News"],
  [10764, "Reality"],
  [10766, "Soap"],
  [10767, "Talk"],
  [10768, "War & Politics"],
  [10770, "TV Movie"],
] as const;
const signature = (p: FeedParams) => stableSerialize({ ...p, cursor: undefined, exclude: [] });
const Slide = memo(function Slide({
  entity,
  priority,
  userId,
}: {
  entity: Entity;
  priority: boolean;
  userId: string;
}) {
  return (
    <article className="discovery-slide">
      <Poster entity={entity} priority={priority} />
      <div className="poster-shade" />
      <div className="slide-top">
        <span className="editorial-badge">
          <Sparkles size={13} />
          {entity.kind === "tv" ? "THE SERIES EDIT" : "THE FILM EDIT"}
        </span>
        <span className="slide-rating">
          <Star size={13} fill="currentColor" />
          {entity.rating?.toFixed(1) ?? "—"}
        </span>
      </div>
      <div className="slide-content">
        <div className="title-meta">
          <span>{entity.kind === "tv" ? "TV SERIES" : "FILM"}</span>
          <span>{entity.year ?? "Date unavailable"}</span>
          {entity.genres?.slice(0, 2).map((g) => (
            <span key={g}>{genres.find(([id]) => g === `tmdb:genre:${id}`)?.[1]}</span>
          ))}
        </div>
        <Link to="/title/$id" params={{ id: entity.id }} className="slide-title">
          <h2>{entity.title}</h2>
          <ArrowUpRight />
        </Link>
        <p className="slide-overview">
          {entity.overview || "Every story starts with a little curiosity. Explore the details."}
        </p>
        <Tags entity={entity} userId={userId} />
      </div>
    </article>
  );
});
export function Discover({ userId }: { userId: string }) {
  const location = useLocation(),
    navigate = useNavigate();
  const params = useMemo(() => {
    const result = feedParams.safeParse(
      Object.fromEntries(new URLSearchParams(location.searchStr)),
    );
    return result.success ? result.data : feedParams.parse({});
  }, [location.searchStr]);
  const statuses = useEntities("status"),
    listItems = useEntities("item");
  const key = signature(params),
    queries = useEntities("query"),
    movies = useEntities("movie"),
    series = useEntities("tv"),
    [displayKey, setDisplayKey] = useState(key),
    [filters, setFilters] = useState(false),
    [genreSheet, setGenreSheet] = useState(false),
    [active, setActive] = useState(0),
    swiper = useRef<SwiperType | null>(null);
  const pages = useMemo(
    () =>
      queries
        .filter(
          (q) =>
            q.id.startsWith("discover:") && signature(q.data.params as FeedParams) === displayKey,
        )
        .sort((a, b) => Number(a.id.split(":").at(-1)) - Number(b.id.split(":").at(-1)))
        .map((q) => ({
          id: q.id,
          ids: q.data.ids as string[],
          coverage: q.data.coverage as Coverage,
          params: q.data.params as FeedParams,
        })),
    [queries, displayKey],
  );
  // Index once per change instead of scanning every status and list item for every title.
  const statusByTitle = useMemo(
    () =>
      new Map(
        statuses
          .filter((s) => s.data.userId === userId)
          .map((s) => [String(s.data.titleId), s.data as { seen: boolean; sentiment: string }]),
      ),
    [statuses, userId],
  );
  const listsByTitle = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const i of listItems) {
      const title = String(i.data.titleId);
      map.set(title, (map.get(title) ?? new Set()).add(String(i.data.listId)));
    }
    return map;
  }, [listItems]);
  const byId = useMemo(
    () => new Map([...movies, ...series].map((e) => [e.id, e])),
    [movies, series],
  );
  const titles = useMemo(
    () =>
      [...new Set(pages.flatMap((p) => p.ids))]
        .map((id) => byId.get(id))
        .filter((e): e is Entity => !!e)
        .filter((e) =>
          localMatch(e, params, statusByTitle.get(e.id), listsByTitle.get(e.id) ?? new Set(), true),
        ),
    [pages, byId, params, statusByTitle, listsByTitle],
  );
  const last = pages.at(-1),
    coverage = last?.coverage;
  const update = (patch: Partial<FeedParams>) =>
    void navigate({
      to: "/",
      search: () =>
        encodeParams({
          ...params,
          ...patch,
          ...(patch.sort === "random" && params.sort !== "random"
            ? { seed: crypto.randomUUID() }
            : {}),
          cursor: undefined,
        }),
    });
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    void discover({ ...params, cursor: undefined }, controller.signal)
      .then(() => {
        if (live) {
          setDisplayKey(key);
          const position = Number(sessionStorage.getItem(`feed-position:${key}`) ?? 0);
          setActive(position);
          swiper.current?.slideTo(position, 0);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) report(error);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [key]);
  useEffect(() => {
    const cleanups = pages.map((p) => subscribeQuery(p.id, p.params));
    return () => cleanups.forEach((fn) => fn());
  }, [pages.map((p) => p.id).join("|")]);
  const nearby = titles
    .slice(active, active + 4)
    .map((e) => e.id)
    .join("|");
  useEffect(
    () => (nearby ? preloadTitles(nearby.split("|"), userId) : undefined),
    [nearby, userId],
  );
  const approachingEnd = titles.length - active <= 12;
  useEffect(() => {
    if (!approachingEnd || !coverage?.nextCursor || coverage.state !== "complete") return;
    const cursor = coverage.nextCursor;
    const controller = new AbortController();
    void discover({ ...params, cursor }, controller.signal, true).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [approachingEnd, coverage?.nextCursor, coverage?.state, key]);
  const activeTitle = titles[active];
  return (
    <div className="discover-page">
      <PageHeading eyebrow="A GOOD NIGHT STARTS HERE" title="Find your next obsession.">
        <span className="live-pill">
          <i />
          Made for your curiosity
        </span>
      </PageHeading>
      <div className="discover-toolbar">
        <div className="segmented" aria-label="Title type">
          {(["both", "movie", "tv"] as const).map((type) => (
            <button
              key={type}
              className={params.type === type ? "active" : ""}
              onClick={() => update({ type })}
            >
              {type === "both" ? "For you" : type === "movie" ? "Movies" : "TV shows"}
            </button>
          ))}
        </div>
        <div className="filter-chips">
          <button
            className={`chip ${params.genres.length ? "chip-active" : ""}`}
            onClick={() => setGenreSheet(true)}
          >
            {params.genres.length ? `${params.genres.length} genres` : "All genres"}
            <ChevronDown size={14} />
          </button>
          <label className="chip sort-chip">
            <span className="sr-only">Sort titles</span>
            <select
              aria-label="Sort titles"
              value={params.sort}
              onChange={(e) => update({ sort: e.target.value as FeedParams["sort"] })}
            >
              <option value="popularity">Popular now</option>
              <option value="trending">Trending</option>
              <option value="rating">Highest rated</option>
              <option value="lowest">Lowest rated</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="random">Surprise me</option>
              <option value="relevance">For my taste</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <button
            className="chip"
            aria-label="Customize feed filters"
            onClick={() => setFilters(true)}
          >
            <SlidersHorizontal size={15} />
            <span>Filters</span>
          </button>
          <button
            className="chip save-feed"
            aria-label="Save this feed"
            onClick={() => {
              const title = window.prompt("Name this feed");
              if (title)
                void send({ type: "feed.save", title, params }, userId)
                  .then(() => notify("Your feed is saved to your profile."))
                  .catch(report);
            }}
          >
            <Bookmark size={15} />
          </button>
        </div>
      </div>
      {(coverage?.state === "error" || !!coverage?.unsupported.length) && (
        <div className="mobile-feed-status">
          {coverage?.state === "error" && (
            <p role="status">Catalog refresh paused. Your cached picks are here.</p>
          )}
          {!!coverage?.unsupported.length && (
            <details>
              <summary>About these filters</summary>
              {coverage.unsupported.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </details>
          )}
        </div>
      )}
      <div className="feed-layout">
        <div className="feed-stage">
          {titles.length ? (
            <Swiper
              key={displayKey}
              modules={[Keyboard, Mousewheel, Virtual, A11y]}
              direction="vertical"
              noSwipingSelector="button, a, input, select"
              slidesPerView={1}
              spaceBetween={20}
              mousewheel={{ forceToAxis: true }}
              keyboard={{ enabled: true }}
              virtual={{ enabled: true, addSlidesBefore: 1, addSlidesAfter: 2, cache: false }}
              initialSlide={Math.min(active, titles.length - 1)}
              onSwiper={(s) => {
                swiper.current = s;
              }}
              onSlideChange={(s) => {
                setActive(s.activeIndex);
                sessionStorage.setItem(`feed-position:${displayKey}`, fieldText(s.activeIndex));
              }}
              className="discovery-swiper"
            >
              {titles.map((entity, index) => (
                <SwiperSlide key={entity.id} virtualIndex={index}>
                  <Slide entity={entity} priority={index === active} userId={userId} />
                </SwiperSlide>
              ))}
            </Swiper>
          ) : (
            <div className="feed-empty">
              <div className="feed-empty-orbit">✦</div>
              <Empty
                title={
                  coverage?.state === "error"
                    ? "The catalog is taking a break."
                    : coverage?.state === "complete"
                      ? "A plot twist: no matches."
                      : "Your next story is on its way."
                }
              >
                {coverage?.message ??
                  (coverage?.state === "complete"
                    ? "Try a wider set of filters. There’s a whole world to discover."
                    : "We’re gathering these titles. They’ll appear here as soon as they arrive.")}
              </Empty>
              <Button
                variant="outline"
                onClick={() =>
                  coverage?.state === "complete"
                    ? update(feedParams.parse({}))
                    : void discover(params).catch(report)
                }
              >
                {coverage?.state === "complete" ? "Reset filters" : "Try again"}
              </Button>
            </div>
          )}
          <div className="swipe-hint">
            <ArrowDown size={13} />
            <span>Swipe for your next great watch</span>
            <span className="feed-count">
              {titles.length ? active + 1 : 0} / {titles.length}
              {coverage?.nextCursor ? " +" : ""}
            </span>
          </div>
        </div>
        <aside className="feed-aside">
          <div className="aside-note">
            <span className="eyebrow">THE JOY OF DISCOVERY</span>
            <h2>
              Go in curious.
              <br />
              Come out <em>obsessed.</em>
            </h2>
            <p>
              A familiar favorite. An unexpected find.
              <br />
              There’s always another story.
            </p>
            <div className="note-rule" />
            <div className="aside-instructions">
              <span>01</span>
              <p>Swipe to explore something new</p>
              <span>02</span>
              <p>Leave a take. Trust your taste.</p>
              <span>03</span>
              <p>Make a list for your next movie night</p>
            </div>
          </div>
          <div className="taste-note">
            <span className="taste-icon">
              <HeartIcon />
            </span>
            <div>
              <strong>Your taste, your rules.</strong>
              <p>
                Seen it? Loved it? Just not your thing?
                <br />
                Keep track with a single tap.
              </p>
            </div>
          </div>
          {coverage && coverage.state !== "complete" && (
            <div role="status" className="coverage-note">
              {coverage.state === "error"
                ? "Catalog refresh paused. Cached titles are available."
                : titles.length
                  ? "Fresh picks are arriving. Keep exploring."
                  : "Connecting the dots behind the scenes."}
            </div>
          )}
          {coverage?.unsupported.map((text) => (
            <p key={text} className="coverage-note">
              {text}
            </p>
          ))}
          {activeTitle && (
            <Link to="/title/$id" params={{ id: activeTitle.id }} className="aside-detail">
              Take a closer look
              <ArrowUpRight size={18} />
            </Link>
          )}
        </aside>
      </div>
      <Sheet
        open={genreSheet}
        onOpenChange={setGenreSheet}
        title="What’s your kind of story?"
        description="Mix a few genres. See where they take you."
      >
        <div className="sheet-body genre-options">
          {genres
            .filter(
              ([id]) =>
                params.type === "both" ||
                params.genres.includes(id) ||
                (params.type === "movie" ? movieGenreIds : tvGenreIds).includes(id),
            )
            .map(([id, name]) => (
              <button
                key={id}
                className={`chip ${params.genres.includes(id) ? "chip-active" : ""}`}
                aria-pressed={params.genres.includes(id)}
                onClick={() =>
                  update({
                    genres: params.genres.includes(id)
                      ? params.genres.filter((g) => g !== id)
                      : [...params.genres, id],
                  })
                }
              >
                {name}
              </button>
            ))}
          <Button onClick={() => setGenreSheet(false)}>Find my next watch</Button>
        </div>
      </Sheet>
      <FilterSheet
        open={filters}
        setOpen={setFilters}
        params={params}
        update={update}
        userId={userId}
      />
    </div>
  );
}
function HeartIcon() {
  return <span>♡</span>;
}
function FilterSheet({
  userId,
  open,
  setOpen,
  params,
  update,
}: {
  userId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  params: FeedParams;
  update: (p: Partial<FeedParams>) => void;
}) {
  const lists = useEntities("list");
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Make it your kind of night."
      description="Layer your filters. We’ll find the stories."
    >
      <form
        className="sheet-body filter-form"
        key={stableSerialize(params)}
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          const result = feedParams.safeParse({ ...params, ...data, cursor: undefined });
          if (!result.success) {
            notify(result.error.issues[0]?.message ?? "Check your filters");
            return;
          }
          update(result.data);
          setOpen(false);
        }}
      >
        <div className="form-grid">
          <label>
            Seen status
            <select name="seen" defaultValue={params.seen}>
              <option value="all">Anything</option>
              <option value="unseen">Not seen yet</option>
              <option value="seen">Seen it</option>
            </select>
          </label>
          <label>
            Your take
            <select name="sentiment" defaultValue={params.sentiment}>
              {["all", "liked", "meh", "disliked", "unrated"].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "Any opinion" : s}
                </option>
              ))}
            </select>
          </label>
          {[
            ["yearMin", "From year", "e.g. 1990"],
            ["yearMax", "To year", "e.g. 2026"],
            ["runtimeMin", "Min. runtime (min)", "0"],
            ["runtimeMax", "Max. runtime (min)", "180"],
            ["ratingMin", "Min. rating", "0"],
            ["ratingMax", "Max. rating", "10"],
            ["votesMin", "Minimum votes", "100"],
            ["popularityMin", "Min. popularity", "0"],
            ["popularityMax", "Max. popularity", "1000"],
          ].map(([key, label, placeholder]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                type="number"
                step={key?.startsWith("rating") || key?.startsWith("popularity") ? "0.1" : "1"}
                min="0"
                placeholder={placeholder}
                defaultValue={fieldText(params[key as keyof FeedParams] ?? "")}
              />
            </label>
          ))}
          <label>
            Original language
            <input
              name="language"
              placeholder="en, fr, ko…"
              maxLength={2}
              defaultValue={params.language}
            />
          </label>
          <label>
            Origin country
            <input
              name="country"
              placeholder="US, FR, KR…"
              maxLength={2}
              defaultValue={params.country}
            />
          </label>
          <label>
            Released after
            <input name="dateMin" type="date" defaultValue={params.dateMin} />
          </label>
          <label>
            Released before
            <input name="dateMax" type="date" defaultValue={params.dateMax} />
          </label>
          <label>
            In list
            <select name="list" defaultValue={params.list ?? ""}>
              <option value="">Any list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Not in list
            <select name="notInList" defaultValue={params.notInList ?? ""}>
              <option value="">No exclusion</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details>
          <summary>Cast, themes & streaming</summary>
          <p className="field-note">
            Use TMDB numeric IDs for precise matching. Cast and crew discovery currently requires
            Movies. TV has its own genre IDs.
          </p>
          {[
            ["cast", "Cast IDs"],
            ["crew", "Director / crew IDs"],
            ["keywords", "Keyword / theme IDs"],
            ["excludeGenres", "Exclude genre IDs"],
            ["providers", "Streaming provider IDs"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                placeholder="Comma-separated IDs"
                defaultValue={(params[key as "cast"] ?? []).join(",")}
              />
            </label>
          ))}
          <label>
            Streaming region
            <input name="region" maxLength={2} defaultValue={params.region} />
          </label>
        </details>
        <div className="sheet-actions">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              update(feedParams.parse({}));
              setOpen(false);
            }}
          >
            Clear filters
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              const result = feedParams.safeParse({
                ...params,
                ...Object.fromEntries(new FormData(form)),
                cursor: undefined,
              });
              if (!result.success) {
                notify(result.error.issues[0]?.message ?? "Check these filters");
                return;
              }
              const title = window.prompt("Name this feed");
              if (title)
                void send({ type: "feed.save", title, params: result.data }, userId)
                  .then(() => {
                    setOpen(false);
                    notify("Your feed is saved to your profile.");
                  })
                  .catch(report);
            }}
          >
            Save feed
          </Button>
          <Button type="submit">
            Find my next watch
            <ArrowUpRight size={16} />
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
