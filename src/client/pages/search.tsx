import { bindNavigation } from "../telemetry";
import { fieldText } from "../../shared/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { Search, ArrowUpRight, Users, Bookmark } from "lucide-react";
import { Button, Group, NavLink, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { feedParams, stableSerialize, type Entity } from "../../shared/contracts";
import { discover, subscribeQuery, useEntities, report, loadSocial } from "../state";
import { useStableOrder } from "../stable-order";
import { DataSection } from "../components/data-section";
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
  const ordered = useStableOrder(query, titles);
  const matches = (e: Entity) => e.title.toLowerCase().includes(query.toLowerCase()),
    filmsAndSeries = useMemo(() => ordered.rows.filter((t) => t.kind !== "person"), [ordered.rows]),
    personResults = useMemo(() => ordered.rows.filter((e) => e.kind === "person"), [ordered.rows]),
    userResults = users.filter(matches),
    listResults = lists.filter(matches);
  return (
    <Stack gap="lg">
      <PageHeading title="Search">
        <Button variant="default" onClick={ordered.refresh} disabled={ordered.isCurrent}>
          Refresh order
        </Button>
      </PageHeading>
      <TextInput
        size="lg"
        variant="filled"
        aria-label="Search movies, series, people, and lists"
        maxLength={200}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Search movies, TV shows, people, and lists"
        autoComplete="off"
        autoFocus
        leftSection={<Search size={20} />}
      />
      {!query ? (
        <Stack>
          <Empty title="Search the catalog">Enter a title, person, member, or list name.</Empty>
          <Group>
            {["Studio Ghibli", "Christopher Nolan", "Severance", "Wong Kar-wai"].map((q, index) => (
              <Button
                variant="light"
                color={["pink", "violet", "cyan", "yellow"][index]}
                key={q}
                onClick={() => setInput(q)}
              >
                {q}
              </Button>
            ))}
          </Group>
        </Stack>
      ) : (
        <>
          <Text size="sm" c="dimmed" role="status" h="3.1em" lineClamp={2}>
            Results for “{query}”
            {meta && (meta.data.coverage as { state: string }).state !== "complete"
              ? " · Search in progress"
              : ""}
          </Text>
          <DataSection title="Movies and TV shows" height="32rem">
            {filmsAndSeries.length ? (
              <Stack>
                <SimpleGrid cols={{ base: 2, xs: 3, md: 4, lg: 5 }}>
                  {filmsAndSeries.slice(0, paging.shown).map((entity) => (
                    <TitleCard key={entity.id} entity={entity} />
                  ))}
                </SimpleGrid>
                <ShowMore total={filmsAndSeries.length} paging={paging} />
              </Stack>
            ) : (
              <Empty title="No movies or TV shows yet">
                Results will appear here as the catalog search completes.
              </Empty>
            )}
          </DataSection>
          <DataSection title="People" height="32rem">
            {personResults.length ? (
              <SimpleGrid cols={{ base: 2, xs: 3, md: 4, lg: 5 }}>
                {personResults.map((entity) => (
                  <TitleCard key={entity.id} entity={entity} />
                ))}
              </SimpleGrid>
            ) : (
              <Empty title="No people found">Matching people will appear here.</Empty>
            )}
          </DataSection>
          <DataSection title="Members" height="16rem">
            {userResults.length ? (
              <Stack>
                {userResults.map((user) => (
                  <NavLink
                    key={user.id}
                    renderRoot={(props) => (
                      <Link {...props} to="/profile/$userId" params={{ userId: user.id }} />
                    )}
                    label={user.title}
                    description={`@${fieldText(user.data.username ?? "member")}`}
                    leftSection={<Users size={20} />}
                    rightSection={<ArrowUpRight size={18} />}
                  />
                ))}
              </Stack>
            ) : (
              <Empty title="No members found">Matching members will appear here.</Empty>
            )}
          </DataSection>
          <DataSection title="Lists" height="16rem">
            {listResults.length ? (
              <Stack>
                {listResults.map((list) => (
                  <NavLink
                    key={list.id}
                    renderRoot={(props) => (
                      <Link {...props} to="/lists/$listId" params={{ listId: list.id }} />
                    )}
                    label={list.title}
                    description={fieldText(list.data.description ?? "")}
                    leftSection={<Bookmark size={20} />}
                    rightSection={<ArrowUpRight size={18} />}
                  />
                ))}
              </Stack>
            ) : (
              <Empty title="No lists found">Matching lists will appear here.</Empty>
            )}
          </DataSection>
        </>
      )}
    </Stack>
  );
}
