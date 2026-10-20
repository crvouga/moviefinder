import { z } from "zod";
import { canonicalId, type Entity, type Kind } from "../../shared/contracts";
export const sourceDocument = z
  .object({
    id: z.number().int().positive(),
    title: z.string().nullish(),
    name: z.string().nullish(),
    overview: z.string().nullish(),
    biography: z.string().nullish(),
    poster_path: z.string().nullish(),
    profile_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    release_date: z.string().nullish(),
    first_air_date: z.string().nullish(),
    original_language: z.string().nullish(),
    popularity: z.number().finite().nonnegative().nullish(),
    vote_average: z.number().finite().min(0).max(10).nullish(),
    vote_count: z.number().int().nonnegative().nullish(),
    genre_ids: z.array(z.number().int().positive()).nullish(),
    genres: z
      .array(
        z.object({ id: z.number().int().positive(), name: z.string().nullish() }).passthrough(),
      )
      .nullish(),
  })
  .passthrough();
export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const array = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(record) : [];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export function kindFor(id: string): Kind {
  return id.includes(":episode:")
    ? "episode"
    : id.includes(":season:")
      ? "season"
      : ((id.split(":")[1] ?? "movie") as Kind);
}
// Long-running series report thousands of cast and crew entries and prolific people hundreds
// of credits. The source JSON keeps all of it; the client projection keeps what a screen shows.
const castLimit = 100,
  crewLimit = 40,
  guestLimit = 30,
  filmographyLimit = 300;
const crewRank = (department: unknown) =>
  ({ Directing: 0, Writing: 1, Production: 2 })[str(department)] ?? 3;
const primitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
// What list-shaped responses (feeds, snapshots, events, saved lists) carry for a title: the entity
// alone with scalar fields. Relations, credits and other collections load with the detail view.
export function summarize(entity: Entity): Entity {
  const { related: _related, ...rest } = entity;
  return {
    ...rest,
    data: {
      ...Object.fromEntries(Object.entries(entity.data).filter(([, v]) => primitive(v))),
      summary: true,
    },
  };
}
export function summaryOf(id: string, payload: unknown, version = 1): Entity[] {
  const primary = normalize(id, payload, version).find((e) => e.id === id);
  return primary ? [summarize(primary)] : [];
}
export function normalize(id: string, payload: unknown, version = 1): Entity[] {
  const p = record(payload),
    kind = kindFor(id),
    genres = array(p.genres).map((g) => canonicalId("genre", num(g.id)));
  if (!genres.length && Array.isArray(p.genre_ids))
    genres.push(...p.genre_ids.map((g) => canonicalId("genre", num(g))));
  const related: Entity[] = [];
  const title = str(p.title) || str(p.name) || "Details unavailable";
  const credits = record(p.credits ?? p.aggregate_credits),
    people = [
      ...array(credits.cast).slice(0, castLimit),
      ...array(credits.crew)
        .sort((a, b) => crewRank(a.department) - crewRank(b.department))
        .slice(0, crewLimit),
      ...array(p.guest_stars).slice(0, guestLimit),
    ];
  const creditIds = people.map((person, i) => {
    const pid = canonicalId("person", num(person.id));
    related.push({
      id: pid,
      kind: "person",
      version: 0,
      title: str(person.name),
      poster: str(person.profile_path) || null,
      data: { department: person.known_for_department },
    });
    const cid = canonicalId(
      "credit",
      str(person.credit_id) || `${id}:${pid}:${str(person.job) || str(person.character) || i}`,
    );
    related.push({
      id: cid,
      kind: "credit",
      version,
      title:
        str(person.character) ||
        str(array(person.roles)[0]?.character) ||
        str(person.job) ||
        str(array(person.jobs)[0]?.job) ||
        str(person.department),
      related: [id, pid],
      data: {
        personId: pid,
        titleId: id,
        character: person.character,
        job: person.job,
        department: person.department,
        order: person.order,
      },
    });
    return cid;
  });
  for (const g of array(p.genres))
    related.push({
      id: canonicalId("genre", num(g.id)),
      kind: "genre",
      version: 0,
      title: str(g.name),
      data: {},
    });
  const relationGroups: Record<string, string[]> = {};
  for (const [key, value] of Object.entries({
    recommendations: p.recommendations,
    similar: p.similar,
    filmography: p.combined_credits,
    knownFor: { results: p.known_for },
  })) {
    const r = record(value),
      everything = [...array(r.results), ...array(r.cast), ...array(r.crew)],
      all =
        key === "filmography"
          ? everything
              .filter((x) => x.media_type !== "person")
              .sort((a, b) => num(b.popularity) - num(a.popularity))
              .slice(0, filmographyLimit)
          : everything;
    relationGroups[key] = [
      ...new Set(
        all
          .filter((x) => x.media_type !== "person")
          .map((x) => {
            const rid = canonicalId(
              x.media_type === "tv" || x.first_air_date ? "tv" : "movie",
              num(x.id),
            );
            related.push(
              ...normalize(
                rid,
                { ...x, credits: undefined, recommendations: undefined, similar: undefined },
                0,
              ),
            );
            if (key === "filmography") {
              const creditId = canonicalId(
                "credit",
                str(x.credit_id) || `${id}:${rid}:${str(x.job) || str(x.character) || "Acting"}`,
              );
              related.push({
                id: creditId,
                kind: "credit",
                version,
                title: str(x.character) || str(x.job) || "Acting",
                related: [id, rid],
                data: {
                  personId: id,
                  titleId: rid,
                  character: x.character,
                  job: x.job,
                  department: x.department ?? "Acting",
                },
              });
            }
            return rid;
          }),
      ),
    ];
  }
  for (const creator of array(p.created_by))
    related.push({
      id: canonicalId("person", num(creator.id)),
      kind: "person",
      version: 0,
      title: str(creator.name),
      poster: str(creator.profile_path) || null,
      data: { department: "Creator" },
    });
  const seasonIds = array(p.seasons).map((s) => {
    const sid = `${id}:season:${num(s.season_number)}`;
    related.push(...normalize(sid, s, 0));
    return sid;
  });
  const episodeIds = array(p.episodes).map((e) => {
    const eid = `${id}:episode:${num(e.episode_number)}`;
    related.push(...normalize(eid, e, 0));
    return eid;
  });
  const year =
    Number(str(p.release_date ?? p.first_air_date ?? p.air_date).slice(0, 4)) || undefined;
  const entity: Entity = {
    id,
    kind,
    version,
    title,
    overview: str(p.overview ?? p.biography),
    poster: str(p.poster_path ?? p.profile_path ?? p.still_path) || null,
    backdrop: str(p.backdrop_path) || null,
    year,
    rating: p.vote_average == null ? undefined : num(p.vote_average),
    popularity: p.popularity == null ? undefined : num(p.popularity),
    genres,
    related: [...creditIds, ...seasonIds, ...episodeIds, ...Object.values(relationGroups).flat()],
    data: {
      filmographyCredits: related
        .filter((e) => e.kind === "credit" && e.data.personId === id)
        .map((e) => e.id),
      originalTitle: p.original_title ?? p.original_name,
      releaseDate: p.release_date ?? p.first_air_date ?? p.air_date,
      lastAirDate: p.last_air_date,
      runtime: p.runtime ?? p.episode_run_time,
      voteCount: p.vote_count,
      language: p.original_language,
      status: p.status,
      tagline: p.tagline,
      homepage: p.homepage,
      imdbId: p.imdb_id ?? record(p.external_ids).imdb_id,
      externalIds: p.external_ids,
      productionCompanies: p.production_companies,
      countries: p.production_countries ?? p.origin_country,
      originCountries: p.origin_country,
      networks: p.networks,
      creators: p.created_by,
      seasons: seasonIds,
      episodes: episodeIds,
      seasonNumber: p.season_number,
      episodeNumber: p.episode_number,
      numberOfSeasons: p.number_of_seasons,
      numberOfEpisodes: p.number_of_episodes,
      credits: creditIds,
      castIds: array(credits.cast).map((p) => num(p.id)),
      crewIds: array(credits.crew).map((p) => num(p.id)),
      relations: relationGroups,
      videos: array(record(p.videos).results)
        .filter((v) => v.site === "YouTube")
        .map((v) => ({ name: v.name, key: v.key, type: v.type })),
      keywords: array(record(p.keywords).keywords ?? record(p.keywords).results),
      collection: p.belongs_to_collection,
      watchProviders: p["watch/providers"],
      birthday: p.birthday,
      deathday: p.deathday,
      birthplace: p.place_of_birth,
      department: p.known_for_department,
      gender: p.gender,
      releaseDates: p.release_dates,
      contentRatings: p.content_ratings,
    },
  };
  const dedup = new Map<string, Entity>();
  for (const e of [...related, entity]) {
    const old = dedup.get(e.id);
    if (!old || e.version >= old.version) dedup.set(e.id, e);
  }
  return [...dedup.values()];
}
