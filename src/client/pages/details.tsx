import { bindNavigation, currentNavigationContext, markNavigationContent } from "../telemetry";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Star,
  Play,
  Calendar,
  Clock,
  MapPin,
  Clapperboard,
  Sparkles,
  Popcorn,
} from "lucide-react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  SimpleGrid,
  ScrollArea,
  Skeleton,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useEntity, useEntities, loadEntity, subscribeEntity, getEntity, report } from "../state";
import { Poster, Tags, TitleCard, External, ShowMore, usePaging } from "../components/common";
import { DataSection } from "../components/data-section";
import { Image } from "../components/image";
import { entityImages } from "../images";
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
  const ready = useScreenReady();
  const [attempt, setAttempt] = useState(0);
  const [filmographyTab, setFilmographyTab] = useState("all");
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
        filmographyTab={filmographyTab}
        onFilmographyTabChange={setFilmographyTab}
      />
    );
  return (
    <DetailPreview
      id={id}
      entity={getEntity(id)}
      userId={userId}
      filmographyTab={filmographyTab}
      onFilmographyTabChange={setFilmographyTab}
    />
  );
}
const detailKind = (id: string) =>
  id.includes(":episode:")
    ? "episode"
    : id.includes(":season:")
      ? "season"
      : (id.split(":")[1] ?? "movie");
function DetailHero({
  id,
  entity,
  userId,
  genreTitles = new Map<string, string>(),
}: {
  id: string;
  entity?: Entity;
  userId: string;
  genreTitles?: Map<string, string>;
}) {
  const kind = detailKind(id),
    person = kind === "person";
  return (
    <Card
      className={entity ? "detail-hero" : "detail-skeleton"}
      padding="lg"
      radius="lg"
      pos="relative"
      aria-busy={!entity || entity.data.summary === true}
    >
      <Box pos="absolute" inset={0} opacity={0.1} aria-hidden="true">
        <Image images={entityImages(entity)} slot={person ? "avatar" : "backdrop"} />
      </Box>
      <SimpleGrid
        cols={4}
        spacing={0}
        pos="absolute"
        top={0}
        left={0}
        right={0}
        h="var(--mantine-spacing-xs)"
        aria-hidden="true"
      >
        {(person
          ? ["cyan.4", "violet.5", "pink.4", "cyan.4"]
          : ["yellow.4", "pink.5", "violet.5", "yellow.4"]
        ).map((color, index) => (
          <Box key={index} bg={color} />
        ))}
      </SimpleGrid>
      <Box
        pos="absolute"
        left="calc(var(--mantine-spacing-sm) * -1)"
        top="50%"
        w="var(--mantine-spacing-lg)"
        h="var(--mantine-spacing-lg)"
        bdrs="xl"
        bg="dark.9"
        aria-hidden="true"
      />
      <Box
        pos="absolute"
        right="calc(var(--mantine-spacing-sm) * -1)"
        top="50%"
        w="var(--mantine-spacing-lg)"
        h="var(--mantine-spacing-lg)"
        bdrs="xl"
        bg="dark.9"
        aria-hidden="true"
      />
      <Grid gap="xl" pos="relative">
        <Grid.Col span={{ base: 12, sm: 4, md: 3 }}>
          <Card
            padding={0}
            shadow="lg"
            radius="lg"
            pos="relative"
            maw={{ base: "10rem", sm: "100%" }}
          >
            <Poster entity={entity} slot="hero" priority />
            <ThemeIcon
              pos="absolute"
              top="var(--mantine-spacing-xs)"
              right="var(--mantine-spacing-xs)"
              size="xl"
              radius="xl"
              color={person ? "cyan" : "pink"}
              variant="filled"
              aria-hidden="true"
            >
              {person ? <Sparkles size={22} /> : <Popcorn size={22} />}
            </ThemeIcon>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 8, md: 9 }}>
          <Stack className="detail-intro" gap="md">
            <Title order={1} h="2.5em" lineClamp={2} c={person ? "cyan.2" : "yellow.2"}>
              {entity?.title ?? (person ? "Person details" : "Title details")}
            </Title>
            <ScrollArea
              h="4rem"
              viewportProps={{ role: "region", "aria-label": "Title facts", tabIndex: 0 }}
            >
              <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" verticalSpacing={0}>
                <Box h="2rem">
                  <Badge
                    variant="filled"
                    size="lg"
                    radius="xl"
                    color={person ? "cyan" : "yellow"}
                    leftSection={person ? <Sparkles size={13} /> : <Clapperboard size={13} />}
                  >
                    {person
                      ? text(entity?.data.department) || "Person"
                      : kind === "tv"
                        ? "TV series"
                        : kind === "movie"
                          ? "Movie"
                          : kind}
                  </Badge>
                </Box>
                <Box h="2rem">
                  {!!(person ? entity?.data.birthday : entity?.year) && (
                    <Group gap="xs" wrap="nowrap">
                      <Calendar size={15} aria-hidden="true" />
                      <Text
                        size="sm"
                        truncate
                        title={text(person ? entity?.data.birthday : entity?.year)}
                      >
                        {person ? `Born ${text(entity?.data.birthday)}` : entity?.year}
                      </Text>
                    </Group>
                  )}
                </Box>
                <Box h="2rem">
                  {person
                    ? !!text(entity?.data.birthplace) && (
                        <Group gap="xs" wrap="nowrap">
                          <MapPin size={15} aria-hidden="true" />
                          <Text size="sm" truncate title={text(entity?.data.birthplace)}>
                            {text(entity?.data.birthplace)}
                          </Text>
                        </Group>
                      )
                    : !!entity?.rating && (
                        <Group gap="xs" wrap="nowrap" c="yellow.4">
                          <Star size={15} aria-hidden="true" />
                          <Text size="sm" fw={600}>
                            {entity.rating.toFixed(1)}
                          </Text>
                        </Group>
                      )}
                </Box>
                <Box h="2rem">
                  {person
                    ? !!text(entity?.data.deathday) && (
                        <Text size="sm" truncate title={text(entity?.data.deathday)}>
                          Died {text(entity?.data.deathday)}
                        </Text>
                      )
                    : !!entity?.data.runtime && (
                        <Group gap="xs" wrap="nowrap">
                          <Clock size={15} aria-hidden="true" />
                          <Text size="sm" truncate>
                            {Array.isArray(entity.data.runtime)
                              ? entity.data.runtime.join("–")
                              : text(entity.data.runtime)}{" "}
                            min
                          </Text>
                        </Group>
                      )}
                </Box>
              </SimpleGrid>
            </ScrollArea>
            {!person && (
              <ScrollArea
                h="2rem"
                viewportProps={{ role: "region", "aria-label": "Genres", tabIndex: 0 }}
              >
                <SimpleGrid cols={{ base: 2, md: 3 }} spacing="sm" verticalSpacing={0}>
                  {entity?.genres?.map((g) => (
                    <Anchor
                      key={g}
                      h="2rem"
                      size="sm"
                      fw={700}
                      c="violet.2"
                      bg="var(--mantine-color-violet-light)"
                      px="sm"
                      bdrs="xl"
                      lh="2rem"
                      truncate
                      renderRoot={(props) => (
                        <Link {...props} to="/" search={{ genres: g.split(":").at(-1) }} />
                      )}
                    >
                      {genreTitles.get(g) ?? getEntity(g)?.title ?? "View genre"}
                    </Anchor>
                  ))}
                </SimpleGrid>
              </ScrollArea>
            )}
            <Stack gap="xs">
              <Text size="xs" fw={800} c={person ? "cyan.4" : "pink.4"} tt="uppercase">
                {person ? "Biography" : "Synopsis"}
              </Text>
              <ScrollArea
                h={person ? "14rem" : "10rem"}
                viewportProps={{
                  role: "region",
                  "aria-label": person ? "Biography" : "Synopsis",
                  tabIndex: 0,
                }}
              >
                {entity ? (
                  <Text c="gray.2">
                    {entity.overview ||
                      (person ? "No biography available." : "No synopsis available.")}
                  </Text>
                ) : (
                  <Stack>
                    <Skeleton h="var(--mantine-spacing-sm)" />
                    <Skeleton h="var(--mantine-spacing-sm)" w="80%" />
                    <Skeleton h="var(--mantine-spacing-sm)" w="60%" />
                  </Stack>
                )}
              </ScrollArea>
            </Stack>
            {["movie", "tv"].includes(kind) && <Tags entity={entity} userId={userId} />}
            <Divider variant="dashed" color={person ? "violet.5" : "pink.5"} />
            <SimpleGrid cols={3} h="3rem">
              <Box>
                {kind === "season" && (
                  <Anchor
                    renderRoot={(props) => (
                      <Link {...props} to="/title/$id" params={{ id: id.split(":season:")[0]! }} />
                    )}
                  >
                    View series
                  </Anchor>
                )}
                {kind === "episode" && (
                  <Anchor
                    renderRoot={(props) => (
                      <Link {...props} to="/title/$id" params={{ id: id.split(":episode:")[0]! }} />
                    )}
                  >
                    View season
                  </Anchor>
                )}
              </Box>
              <Box>
                {text(entity?.data.imdbId) && (
                  <External
                    href={`https://www.imdb.com/${person ? "name" : "title"}/${text(entity?.data.imdbId)}`}
                  >
                    IMDb
                  </External>
                )}
              </Box>
              <Box>
                {text(entity?.data.homepage).startsWith("https://") && (
                  <External href={text(entity?.data.homepage)}>Official website</External>
                )}
              </Box>
            </SimpleGrid>
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  );
}
function DetailBack() {
  const router = useRouter();
  return (
    <Group mih="2.75rem">
      <Button
        variant="subtle"
        leftSection={<ArrowLeft size={16} />}
        onClick={() =>
          router.history.length > 1 ? router.history.back() : router.navigate({ to: "/" })
        }
      >
        Back
      </Button>
    </Group>
  );
}
const sectionLayout = (kind: string) => [
  ...(["movie", "tv"].includes(kind)
    ? [
        ["videos", "Videos", "8rem"],
        ["creators", "Creators", "8rem"],
      ]
    : []),
  ...(kind !== "person" ? [["cast", "Cast and crew", "24rem"]] : []),
  ...(kind === "tv" ? [["seasons", "Seasons", "24rem"]] : []),
  ...(kind === "season" ? [["episodes", "Episodes", "24rem"]] : []),
  ["metadata", kind === "person" ? "Biography details" : "Details", "18rem"],
  ...(["movie", "tv"].includes(kind) ? [["providers", "Where to watch", "10rem"]] : []),
  ["related", kind === "person" ? "Filmography" : "Related titles", "32rem"],
];
function Filmography({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <Tabs
      value={value}
      onChange={(next) => onChange(next ?? "all")}
      variant="pills"
      color="cyan"
      radius="xl"
    >
      <Tabs.List>
        {[
          ["all", "All credits"],
          ["Acting", "Acting"],
          ["Directing", "Directing"],
          ["Writing", "Writing"],
          ["other", "Other crew"],
        ].map(([key, label]) => (
          <Tabs.Tab key={key} value={key!} fw={700}>
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {["all", "Acting", "Directing", "Writing", "other"].map((key) => (
        <Tabs.Panel key={key} value={key} pt="md">
          {key === value ? (children ?? <Skeleton h="var(--mantine-spacing-sm)" w="60%" />) : null}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
function DetailSections({
  kind,
  content,
  filmographyTab,
  onFilmographyTabChange,
}: {
  kind: string;
  content?: Record<string, React.ReactNode>;
  filmographyTab: string;
  onFilmographyTabChange: (value: string) => void;
}) {
  return (
    <>
      {sectionLayout(kind).map(([key, title, height]) => (
        <DataSection key={key} title={title!} height={height}>
          {kind === "person" && key === "related" ? (
            <Filmography value={filmographyTab} onChange={onFilmographyTabChange}>
              {content?.[key!]}
            </Filmography>
          ) : (
            content?.[key!]
          )}
        </DataSection>
      ))}
      <Text size="xs" c="dimmed">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </Text>
    </>
  );
}
// Keep feedback and retry inside the same reserved slot on small screens too.
function DetailStatus({
  loading = false,
  failed = false,
  retry,
}: {
  loading?: boolean;
  failed?: boolean;
  retry?: () => void;
}) {
  return (
    <Box className="detail-status" h="4rem" role="status">
      {(loading || failed) && (
        <Alert color={failed ? "red" : "gray"} p="xs">
          <Group wrap="nowrap" gap="sm">
            <Text flex={1} miw={0} size="sm" h="3.1em" lineClamp={2}>
              {failed ? "Unable to fetch details." : "Fetching details…"}
            </Text>
            {failed && retry && (
              <Button variant="default" size="sm" onClick={retry}>
                Try again
              </Button>
            )}
          </Group>
        </Alert>
      )}
    </Box>
  );
}
function DetailPreview({
  id,
  entity,
  userId,
  failed = false,
  retry,
  filmographyTab,
  onFilmographyTabChange,
}: {
  id: string;
  entity?: Entity;
  userId: string;
  failed?: boolean;
  retry?: () => void;
  filmographyTab: string;
  onFilmographyTabChange: (value: string) => void;
}) {
  return (
    <Stack className="detail-page" data-title-id={id} data-content-ready="false" gap="xl">
      <DetailBack />
      <DetailHero id={id} entity={entity} userId={userId} />
      <DetailStatus loading failed={failed} retry={retry} />
      <DetailSections
        kind={detailKind(id)}
        filmographyTab={filmographyTab}
        onFilmographyTabChange={onFilmographyTabChange}
      />
    </Stack>
  );
}

function DetailContent({
  userId,
  failed,
  retry,
  filmographyTab,
  onFilmographyTabChange,
}: {
  userId: string;
  failed: boolean;
  retry: () => void;
  filmographyTab: string;
  onFilmographyTabChange: (value: string) => void;
}) {
  const { id } = useParams({ strict: false }) as { id: string },
    entity = useEntity(id) ?? getEntity(id),
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
      <DetailPreview
        id={id}
        userId={userId}
        failed={failed}
        retry={retry}
        filmographyTab={filmographyTab}
        onFilmographyTabChange={onFilmographyTabChange}
      />
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
  const relatedContent = (
    <Stack>
      <SimpleGrid cols={{ base: 2, xs: 3, md: 4, lg: 5 }}>
        {visibleRelated.slice(0, paging.shown).map((e) => (
          <TitleCard key={e.id} entity={e} />
        ))}
      </SimpleGrid>
      <ShowMore total={visibleRelated.length} paging={paging} />
    </Stack>
  );
  const metadata = person
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
        ["Popularity", entity.popularity],
        ["Votes", entity.data.voteCount],
        ["Original title", entity.data.originalTitle],
        ["Tagline", entity.data.tagline],
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
        ...(entity.kind === "tv"
          ? [
              ["Latest air date", entity.data.lastAirDate],
              ["Seasons", entity.data.numberOfSeasons],
              ["Episodes", entity.data.numberOfEpisodes],
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
          : []),
      ];
  const unavailable = (label: string) => (
    <Text c="dimmed">
      {entity.data.summary === true || entity.data.graphScope === "viewport"
        ? `Fetching ${label}…`
        : `No ${label} available.`}
    </Text>
  );
  const content: Record<string, React.ReactNode> = {
    videos: records(entity.data.videos).length ? (
      <Stack>
        {records(entity.data.videos)
          .slice(0, 6)
          .map((video) => (
            <External
              key={text(video.key)}
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(text(video.key))}`}
            >
              <Play size={17} />
              {text(video.name)}
            </External>
          ))}
      </Stack>
    ) : (
      unavailable("videos")
    ),
    creators: records(entity.data.creators).length ? (
      <Group>
        {records(entity.data.creators).map((creator) => (
          <Anchor
            key={text(creator.id)}
            renderRoot={(props) => (
              <Link {...props} to="/title/$id" params={{ id: `tmdb:person:${text(creator.id)}` }} />
            )}
          >
            {text(creator.name)}
          </Anchor>
        ))}
      </Group>
    ) : (
      unavailable("creators")
    ),
    cast: cast.length ? (
      <SimpleGrid cols={{ base: 2, xs: 3, md: 4, lg: 6 }}>
        {cast.map((credit) => {
          const personEntity = byId.get(text(credit.data.personId));
          return (
            <Anchor
              key={credit.id}
              renderRoot={(props) => (
                <Link {...props} to="/title/$id" params={{ id: text(credit.data.personId) }} />
              )}
              className="person-card"
              c="inherit"
              underline="hover"
              bg="dark.7"
              p="sm"
              bdrs="lg"
            >
              <Stack gap="xs">
                <Poster entity={personEntity} slot="thumb" />
                <Title order={3} ff="text" fw={600} lineClamp={2} h="2.8em">
                  {personEntity?.title ?? "Person details"}
                </Title>
                <Text size="sm" c="dimmed" lineClamp={2} h="3.1em">
                  {credit.title || "Cast & crew"}
                </Text>
              </Stack>
            </Anchor>
          );
        })}
      </SimpleGrid>
    ) : (
      unavailable("credits")
    ),
    seasons: ids(entity.data.seasons).length ? (
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {ids(entity.data.seasons).map((seasonId) => {
          const season = byId.get(seasonId);
          return (
            <Anchor
              key={seasonId}
              className="season-card"
              bg="dark.7"
              p="sm"
              bdrs="lg"
              renderRoot={(props) => <Link {...props} to="/title/$id" params={{ id: seasonId }} />}
              c="inherit"
              underline="hover"
            >
              <Group wrap="nowrap">
                <Box w="3.5rem" miw="3.5rem">
                  <Poster entity={season} slot="thumb" />
                </Box>
                <Stack gap="xs">
                  <Title order={3} ff="text" fw={600} lineClamp={2} h="2.8em">
                    {season?.title ?? "Season"}
                  </Title>
                  <Text size="sm" c="dimmed" h="1.55em">
                    {season?.year ?? "Air date unavailable"}
                  </Text>
                </Stack>
              </Group>
            </Anchor>
          );
        })}
      </SimpleGrid>
    ) : (
      unavailable("seasons")
    ),
    episodes: ids(entity.data.episodes).length ? (
      <Stack>
        {ids(entity.data.episodes).map((episodeId) => {
          const episode = byId.get(episodeId);
          return (
            <Anchor
              key={episodeId}
              className="episode-row"
              bg="dark.7"
              p="sm"
              bdrs="lg"
              renderRoot={(props) => <Link {...props} to="/title/$id" params={{ id: episodeId }} />}
              c="inherit"
              underline="hover"
            >
              <Group wrap="nowrap" align="flex-start">
                <Box w={{ base: "5rem", sm: "8rem" }} miw="5rem">
                  <Poster entity={episode} slot="still" />
                </Box>
                <Stack gap="xs" flex={1} miw={0}>
                  <Title order={3} ff="text" fw={600} lineClamp={2} h="2.8em">
                    {text(episode?.data.episodeNumber).padStart(2, "0")}.{" "}
                    {episode?.title ?? "Episode"}
                  </Title>
                  <Text size="sm" c="dimmed" h="1.55em">
                    {text(episode?.data.releaseDate) || "Air date unavailable"}
                  </Text>
                  <Text size="sm" lineClamp={2} h="3.1em">
                    {episode?.overview || "No episode description available."}
                  </Text>
                </Stack>
              </Group>
            </Anchor>
          );
        })}
      </Stack>
    ) : (
      unavailable("episodes")
    ),
    metadata: (
      <Stack>
        <SimpleGrid component="dl" m={0} cols={{ base: 1, xs: 2, md: 3 }}>
          {metadata.map(([label, value]) => (
            <Box
              key={text(label)}
              h="6rem"
              bg={person ? "var(--mantine-color-cyan-light)" : "dark.7"}
              p="sm"
              bdrs="lg"
            >
              <Text
                component="dt"
                size="xs"
                fw={800}
                c={person ? "cyan.4" : "pink.4"}
                tt="uppercase"
              >
                {text(label)}
              </Text>
              <Text component="dd" m={0} h="3.1em" lineClamp={2} title={text(value)}>
                {text(value) || "Unavailable"}
              </Text>
            </Box>
          ))}
        </SimpleGrid>
        <Box h="2rem">
          {!!entity.data.collection && (
            <Anchor
              truncate
              renderRoot={(props) => (
                <Link
                  {...props}
                  to="/search"
                  search={{ q: text((entity.data.collection as Record<string, unknown>).name) }}
                />
              )}
            >
              View {text((entity.data.collection as Record<string, unknown>).name)}
            </Anchor>
          )}
        </Box>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
          {records(entity.data.keywords).map((keyword) => (
            <Anchor
              key={text(keyword.id)}
              h="2rem"
              truncate
              renderRoot={(props) => (
                <Link {...props} to="/" search={{ keywords: text(keyword.id) }} />
              )}
            >
              {text(keyword.name)}
            </Anchor>
          ))}
        </SimpleGrid>
      </Stack>
    ),
    providers: <Providers value={entity.data.watchProviders} />,
    related: related.length
      ? relatedContent
      : unavailable(person ? "filmography" : "related titles"),
  };
  return (
    <Stack
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
      gap="xl"
    >
      <DetailBack />
      <DetailHero id={id} entity={entity} userId={userId} genreTitles={genreTitles} />
      <DetailStatus
        loading={entity.data.graphScope === "viewport" || entity.data.summary === true}
        failed={failed}
        retry={retry}
      />
      <DetailSections
        kind={detailKind(id)}
        content={content}
        filmographyTab={filmographyTab}
        onFilmographyTabChange={onFilmographyTabChange}
      />
    </Stack>
  );
}
function Providers({ value }: { value: unknown }) {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {},
    results = root.results as Record<string, Record<string, unknown>> | undefined,
    region = results?.US,
    providers = records(region?.flatrate);
  return (
    <Stack>
      {providers.length ? (
        <>
          <Text size="sm" c="dimmed">
            Subscription streaming in the US · availability by JustWatch via TMDB
          </Text>
          <Group>
            {providers.map((provider) => (
              <Badge variant="light" key={text(provider.provider_id)}>
                {text(provider.provider_name)}
              </Badge>
            ))}
          </Group>
          {text(region?.link).startsWith("https://") && (
            <External href={text(region?.link)}>Check current availability</External>
          )}
        </>
      ) : (
        <Text c="dimmed">No streaming availability provided for this region.</Text>
      )}
    </Stack>
  );
}
