import { bindNavigation } from "../telemetry";
import { preloadTitles } from "../preloading";
import { movieGenreIds, tvGenreIds } from "../../shared/genres";
import { localMatch } from "../../shared/filters";
import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard, Mousewheel, Virtual, A11y } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import {
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Star,
  Bookmark,
  ArrowDown,
  ArrowUp,
  Film,
  Tv,
  Popcorn,
  Ticket,
} from "lucide-react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  Flex,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useReducedMotion } from "@mantine/hooks";
import {
  feedParams,
  stableSerialize,
  type FeedParams,
  type Coverage,
  type Entity,
} from "../../shared/contracts";
import { feedParams as parseFeedParams } from "../../shared/contracts";
import {
  useEntities,
  discover,
  subscribeQuery,
  encodeParams,
  send,
  report,
  notify,
} from "../state";
import { Tags, PageHeading, Empty } from "../components/common";
import { Image } from "../components/image";
import { entityImages } from "../images";
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
    <Card component="article" className="discovery-slide" h="100%" p={0} radius="lg" shadow="md">
      <Flex direction={{ base: "column", md: "row" }} h="100%">
        <Box
          className="slide-artwork"
          pos="relative"
          w={{ base: "100%", md: "42%" }}
          h={{ base: "42%", md: "100%" }}
          bg="dark.9"
        >
          <Image
            images={entityImages(entity)}
            slot="feed"
            priority={priority}
            alt={`${entity.title} poster`}
            fallback={<Empty title="No image">{entity.title}</Empty>}
          />
          <Box
            data-artwork-sticker
            pos="absolute"
            top="var(--mantine-spacing-md)"
            left="var(--mantine-spacing-md)"
          >
            <Badge
              size="lg"
              variant="gradient"
              gradient={{ from: "violet.8", to: "pink.8", deg: 45 }}
              leftSection={entity.kind === "tv" ? <Tv size={14} /> : <Film size={14} />}
            >
              {entity.kind === "tv" ? "TV series" : "Movie"}
            </Badge>
          </Box>
          <Group
            data-artwork-sticker
            pos="absolute"
            bottom="var(--mantine-spacing-md)"
            left="var(--mantine-spacing-md)"
            gap="xs"
            aria-hidden="true"
          >
            <ThemeIcon color="yellow" variant="filled" radius="xl" size="xl">
              <Popcorn size={24} />
            </ThemeIcon>
            <ThemeIcon color="pink" variant="light" radius="xl" size="lg">
              <Ticket size={18} />
            </ThemeIcon>
          </Group>
        </Box>
        <ScrollArea
          flex={1}
          viewportProps={{
            role: "region",
            "aria-label": `${entity.title} information`,
            tabIndex: 0,
          }}
        >
          <Stack p={{ base: "md", sm: "xl" }} gap="lg">
            <Group gap="xs" justify="space-between" wrap="nowrap" h="2rem">
              <Text size="sm" c="cyan.3" fw={700} w="8rem" truncate>
                {entity.year ?? "Date unavailable"}
              </Text>
              <Box w="4rem" h="1.5rem">
                {!!entity.rating && (
                  <Badge variant="filled" color="yellow" leftSection={<Star size={12} />}>
                    {entity.rating.toFixed(1)}
                  </Badge>
                )}
              </Box>
            </Group>
            <Anchor
              renderRoot={(props) => <Link {...props} to="/title/$id" params={{ id: entity.id }} />}

              className="slide-title"
              c="inherit"
              underline="hover"
            >
              <Title order={2} size="h1" lineClamp={2} h="2.5em">
                {entity.title}
              </Title>
            </Anchor>
            <Group gap="md" h="1.55rem" wrap="nowrap">
              <Text size="sm" c="dimmed" truncate>
                {entity.genres
                  ?.slice(0, 3)
                  .map((g) => genres.find(([id]) => g === `tmdb:genre:${id}`)?.[1])
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Group>
            <Divider variant="dashed" color="violet.5" />
            <Text size="sm" lineClamp={4} h="6.2em">
              {entity.overview || "No synopsis available."}
            </Text>
            <Tags entity={entity} userId={userId} compact />
            <Button
              variant="filled"
              color="yellow"
              renderRoot={(props) => <Link {...props} to="/title/$id" params={{ id: entity.id }} />}
              rightSection={<ChevronRight size={16} />}
              leftSection={<Ticket size={18} />}
              fullWidth
            >
              View details
            </Button>
          </Stack>
        </ScrollArea>
      </Flex>
    </Card>
  );
});
export function Discover({ userId }: { userId: string }) {
  const search = useSearch({ strict: false }),
    navigate = useNavigate();
  const params = useMemo(() => {
    const result = feedParams.safeParse(search);
    return result.success ? result.data : feedParams.parse({});
  }, [search]);
  const statuses = useEntities("status"),
    listItems = useEntities("item");
  const key = signature(params),
    queries = useEntities("query"),
    movies = useEntities("movie"),
    series = useEntities("tv"),
    displayKey = key,
    [savedParams, setSavedParams] = useState<FeedParams | null>(null),
    [filters, setFilters] = useState(false),
    [genreSheet, setGenreSheet] = useState(false),
    [selection, setSelection] = useState(() => ({
      key,
      index: Number(sessionStorage.getItem(`feed-position:${key}`) ?? 0),
    })),
    active =
      selection.key === key
        ? selection.index
        : Number(sessionStorage.getItem(`feed-position:${key}`) ?? 0),
    swiper = useRef<SwiperType | null>(null);
  const setActive = (index: number) => setSelection({ key, index });
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
    bindNavigation(controller.signal, window.location.href);
    void discover({ ...params, cursor: undefined }, controller.signal)
      .then(() => {
        if (live) {
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
    bindNavigation(controller.signal, window.location.href);
    void discover({ ...params, cursor }, controller.signal, true).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [approachingEnd, coverage?.nextCursor, coverage?.state, key]);
  const reducedMotion = useReducedMotion();
  return (
    <Stack gap="lg">
      <PageHeading title="Discover" />
      <Paper withBorder p="sm" radius="lg">
        <Group justify="space-between" gap="sm">
          <SegmentedControl
            color="violet.7"
            radius="xl"
            aria-label="Title type"
            value={params.type}
            onChange={(type) => update({ type: type as FeedParams["type"] })}
            data={[
              { value: "both", label: "All titles" },
              { value: "movie", label: "Movies" },
              { value: "tv", label: "TV shows" },
            ]}
          />
          <Group gap="sm">
            <Button
              variant="light"
              color="pink"
              rightSection={<ChevronDown size={14} />}
              w="10rem"
              onClick={() => setGenreSheet(true)}
            >
              {params.genres.length ? `${params.genres.length} genres` : "All genres"}
            </Button>
            <NativeSelect
              aria-label="Sort titles"
              w="11rem"
              value={params.sort}
              onChange={(e) => update({ sort: e.target.value as FeedParams["sort"] })}
              data={[
                { value: "popularity", label: "Popularity" },
                { value: "trending", label: "Trending" },
                { value: "rating", label: "Highest rated" },
                { value: "lowest", label: "Lowest rated" },
                { value: "newest", label: "Newest first" },
                { value: "oldest", label: "Oldest first" },
                { value: "random", label: "Random" },
                { value: "relevance", label: "Relevance" },
              ]}
            />
            <Button
              variant="light"
              color="cyan"
              aria-label="Customize feed filters"
              leftSection={<SlidersHorizontal size={16} />}
              onClick={() => setFilters(true)}
            >
              Filters
            </Button>
            <ActionIcon
              aria-label="Save this feed"
              variant="light"
              color="yellow"
              onClick={() => setSavedParams(params)}
            >
              <Bookmark size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Paper>
      <Box>
        {titles.length ? (
          <Box
            component={Swiper}
            h="40rem"
            key={displayKey}
            modules={[Keyboard, Mousewheel, Virtual, A11y]}
            direction="vertical"
            noSwipingSelector="button, a, input, select, label, [role=dialog]"
            slidesPerView={1}
            spaceBetween={20}
            speed={reducedMotion ? 0 : 300}
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
          </Box>
        ) : (
          <Paper withBorder h="40rem">
            <Stack align="center" justify="center" h="100%" py="xl">
              <Empty
                title={
                  coverage?.state === "error"
                    ? "Unable to refresh titles"
                    : coverage?.state === "complete"
                      ? "No matching titles"
                      : "Fetching titles"
                }
              >
                {coverage?.message ??
                  (coverage?.state === "complete"
                    ? "Adjust or reset the filters to see more titles."
                    : "Titles will appear as they become available.")}
              </Empty>
              <Button
                variant="default"
                onClick={() =>
                  coverage?.state === "complete"
                    ? update(feedParams.parse({}))
                    : void discover(params).catch(report)
                }
              >
                {coverage?.state === "complete" ? "Reset filters" : "Try again"}
              </Button>
            </Stack>
          </Paper>
        )}
        <Group justify="space-between" mt="sm" px="xs">
          <Text size="sm" c="dimmed">
            Swipe or use the arrows to browse
          </Text>
          <Group gap="xs">
            <ActionIcon
              aria-label="Previous title"
              variant="light"
              color="violet"
              disabled={!titles.length || active === 0}
              onClick={() => swiper.current?.slidePrev()}
            >
              <ArrowUp size={18} />
            </ActionIcon>
            <Group w="8rem" gap={0} wrap="nowrap" aria-label="Title position">
              <Text size="sm" ff="monospace" w="5ch">
                {titles.length ? active + 1 : 0}
              </Text>
              <Text size="sm" ff="monospace" w="2ch">
                /
              </Text>
              <Text size="sm" ff="monospace" w="5ch">
                {titles.length}
              </Text>
              <Text size="sm" ff="monospace" w="1ch">
                {coverage?.nextCursor ? "+" : ""}
              </Text>
            </Group>
            <ActionIcon
              aria-label="Next title"
              variant="light"
              color="violet"
              disabled={!titles.length || active >= titles.length - 1}
              onClick={() => swiper.current?.slideNext()}
            >
              <ArrowDown size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Box>
      {coverage?.state === "error" && (
        <Alert color="red" title="Catalog refresh paused">
          Cached titles are available. {coverage.message}
        </Alert>
      )}
      {!!coverage?.unsupported.length && (
        <Alert title="Filter availability">
          {coverage.unsupported.map((message) => (
            <Text key={message} size="sm">
              {message}
            </Text>
          ))}
        </Alert>
      )}
      <Drawer opened={genreSheet} onClose={() => setGenreSheet(false)} title="Genres">
        <Stack>
          <Checkbox.Group
            label="Filter by genre"
            value={params.genres.map(String)}
            onChange={(values) => update({ genres: values.map(Number) })}
          >
            <SimpleGrid cols={{ base: 1, xs: 2 }} mt="md">
              {genres
                .filter(
                  ([id]) =>
                    params.type === "both" ||
                    params.genres.includes(id) ||
                    (params.type === "movie" ? movieGenreIds : tvGenreIds).includes(id),
                )
                .map(([id, name]) => (
                  <Checkbox key={id} value={String(id)} label={name} />
                ))}
            </SimpleGrid>
          </Checkbox.Group>
          <Button onClick={() => setGenreSheet(false)}>Done</Button>
        </Stack>
      </Drawer>
      <FilterSheet
        open={filters}
        setOpen={setFilters}
        params={params}
        update={update}
        onSave={(value) => {
          setFilters(false);
          setSavedParams(value);
        }}
      />
      <SaveFeed params={savedParams} userId={userId} onClose={() => setSavedParams(null)} />
    </Stack>
  );
}
function SaveFeed({
  params,
  userId,
  onClose,
}: {
  params: FeedParams | null;
  userId: string;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Modal opened={!!params} onClose={onClose} title="Save feed">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!params || saving) return;
          const title = fieldText(new FormData(event.currentTarget).get("title") ?? "").trim();
          if (!title) return;
          setSaving(true);
          void send({ type: "feed.save", title, params }, userId)
            .then(() => {
              onClose();
              notify("Feed saved.");
            })
            .catch(report)
            .finally(() => setSaving(false));
        }}
      >
        <Stack>
          <TextInput name="title" label="Feed name" required maxLength={120} data-autofocus />
          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save feed
            </Button>
          </Group>
        </Stack>
      </Box>
    </Modal>
  );
}
function FilterSheet({
  open,
  setOpen,
  params,
  update,
  onSave,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  params: FeedParams;
  update: (p: Partial<FeedParams>) => void;
  onSave: (params: FeedParams) => void;
}) {
  const lists = useEntities("list");
  const parse = (form: HTMLFormElement) => {
    const result = parseFeedParams.safeParse({
      ...params,
      ...Object.fromEntries(new FormData(form)),
      cursor: undefined,
    });
    if (!result.success) {
      notify(result.error.issues[0]?.message ?? "Check your filters");
      return;
    }
    return result.data;
  };
  return (
    <Drawer opened={open} onClose={() => setOpen(false)} title="Feed filters">
      <Box
        component="form"
        key={stableSerialize(params)}
        onSubmit={(event) => {
          event.preventDefault();
          const result = parse(event.currentTarget);
          if (result) {
            update(result);
            setOpen(false);
          }
        }}
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <NativeSelect
              name="seen"
              label="Seen status"
              defaultValue={params.seen}
              data={[
                { value: "all", label: "All titles" },
                { value: "unseen", label: "Unseen" },
                { value: "seen", label: "Seen" },
              ]}
            />
            <NativeSelect
              name="sentiment"
              label="Sentiment"
              defaultValue={params.sentiment}
              data={[
                { value: "all", label: "All sentiments" },
                ...["liked", "meh", "disliked", "unrated"].map((value) => ({
                  value,
                  label: value,
                })),
              ]}
            />
            {[
              ["yearMin", "From year"],
              ["yearMax", "To year"],
              ["runtimeMin", "Min. runtime (min)"],
              ["runtimeMax", "Max. runtime (min)"],
              ["ratingMin", "Min. rating"],
              ["ratingMax", "Max. rating"],
              ["votesMin", "Minimum votes"],
              ["popularityMin", "Min. popularity"],
              ["popularityMax", "Max. popularity"],
            ].map(([key, label]) => (
              <NumberInput
                key={key}
                name={key}
                label={label}
                min={0}
                step={key!.startsWith("rating") || key!.startsWith("popularity") ? 0.1 : 1}
                defaultValue={params[key as keyof FeedParams] as number | undefined}
              />
            ))}
            <TextInput
              name="language"
              label="Original language"
              description="Two-letter code, such as en"
              maxLength={2}
              defaultValue={params.language}
            />
            <TextInput
              name="country"
              label="Origin country"
              description="Two-letter code, such as US"
              maxLength={2}
              defaultValue={params.country}
            />
            <DateInput
              name="dateMin"
              label="Released after"
              defaultValue={params.dateMin || null}
              valueFormat="YYYY-MM-DD"
              clearable
            />
            <DateInput
              name="dateMax"
              label="Released before"
              defaultValue={params.dateMax || null}
              valueFormat="YYYY-MM-DD"
              clearable
            />
            <NativeSelect
              name="list"
              label="In list"
              defaultValue={params.list ?? ""}
              data={[
                { value: "", label: "Any list" },
                ...lists.map((l) => ({ value: l.id, label: l.title })),
              ]}
            />
            <NativeSelect
              name="notInList"
              label="Not in list"
              defaultValue={params.notInList ?? ""}
              data={[
                { value: "", label: "No exclusion" },
                ...lists.map((l) => ({ value: l.id, label: l.title })),
              ]}
            />
          </SimpleGrid>
          <Accordion variant="default">
            <Accordion.Item value="advanced">
              <Accordion.Control>Cast, themes &amp; streaming</Accordion.Control>
              <Accordion.Panel>
                <Stack>
                  <Text size="sm" c="dimmed">
                    Use TMDB numeric IDs for precise matching. Cast and crew filters require Movies.
                    TV uses its own genre IDs.
                  </Text>
                  {[
                    ["cast", "Cast IDs"],
                    ["crew", "Director / crew IDs"],
                    ["keywords", "Keyword / theme IDs"],
                    ["excludeGenres", "Exclude genre IDs"],
                    ["providers", "Streaming provider IDs"],
                  ].map(([key, label]) => (
                    <TextInput
                      key={key}
                      name={key}
                      label={label}
                      description="Comma-separated IDs"
                      defaultValue={(params[key as "cast"] ?? []).join(",")}
                    />
                  ))}
                  <TextInput
                    name="region"
                    label="Streaming region"
                    maxLength={2}
                    defaultValue={params.region}
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
          <Group>
            <Button
              variant="subtle"
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
              variant="default"
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form || !form.reportValidity()) return;
                const result = parse(form);
                if (result) onSave(result);
              }}
            >
              Save feed
            </Button>
            <Button type="submit">Apply filters</Button>
          </Group>
        </Stack>
      </Box>
    </Drawer>
  );
}
