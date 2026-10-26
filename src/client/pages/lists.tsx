import { bindNavigation } from "../telemetry";
import { feedParams } from "../../shared/contracts";
import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
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
import { ActivityCaption, Poster, PageHeading, Empty } from "../components/common";
import { useListItems, useTitles, useUsers, useViewerStatuses } from "../components/viewer";
import {
  ActionIcon,
  AspectRatio,
  ScrollArea,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  Grid,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
export const ListCard = memo(function ListCard({ list }: { list: Entity }) {
  const entries = useListItems(list.id),
    byId = useTitles(),
    owner = useUsers().get(fieldText(list.data.ownerId));
  return (
    <Card
      renderRoot={(props) => <Link {...props} to="/lists/$listId" params={{ listId: list.id }} />}

      className="list-card"
      c="inherit"
    >
      <Stack gap="sm">
        <AspectRatio ratio={2}>
          {entries.length ? (
            <SimpleGrid cols={3} spacing="xs">
              {entries.slice(0, 3).map((entry) => (
                <Poster
                  key={entry.id}
                  entity={byId.get(fieldText(entry.data.titleId))}
                  slot="thumb"
                />
              ))}
            </SimpleGrid>
          ) : (
            <Group mih="8rem" justify="center">
              <Bookmark size={24} />
              <Text c="dimmed">No titles</Text>
            </Group>
          )}
        </AspectRatio>
        <Title order={3} ff="var(--mantine-font-family)" h="2.8em" lineClamp={2}>
          {list.title}
        </Title>
        <Text size="sm" c="dimmed" h="1.55em" lineClamp={1}>
          {entries.length} titles · {owner?.title ?? "Unknown owner"}
        </Text>
      </Stack>
    </Card>
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
    bindNavigation(controller.signal, window.location.href);
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
    <Stack gap="lg">
      <PageHeading title="Lists">
        <Button leftSection={<Plus size={17} />} onClick={() => setCreate(true)}>
          New list
        </Button>
      </PageHeading>
      <Tabs value={tab} onChange={(value) => setTab(value ?? "yours")}>
        <Tabs.List>
          {[
            ["yours", "Your lists"],
            ["saved", "Saved lists"],
            ["explore", "Explore lists"],
          ].map(([value, label]) => (
            <Tabs.Tab key={value} value={value!}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {["yours", "saved", "explore"]
          .filter((value) => value !== tab)
          .map((value) => (
            <Tabs.Panel key={value} value={value}>
              {null}
            </Tabs.Panel>
          ))}
        <Tabs.Panel value={tab} pt="lg">
          <ScrollArea h="32rem">
            <Stack>
              {visible.length ? (
                <SimpleGrid cols={{ base: 1, xs: 2, lg: 3 }}>
                  {visible.map((l) => (
                    <ListCard key={l.id} list={l} />
                  ))}
                </SimpleGrid>
              ) : (
                <Empty
                  title={
                    tab === "saved"
                      ? "No saved lists"
                      : tab === "explore"
                        ? "No lists available"
                        : "No lists yet"
                  }
                >
                  {tab === "saved"
                    ? "Save public lists to find them here."
                    : tab === "explore"
                      ? "Public lists will appear here."
                      : "Create a list to organize movies and TV shows."}
                </Empty>
              )}
              {nextPage && (
                <Button
                  variant="default"
                  onClick={() => void loadSocial("lists", tab, nextPage).catch(report)}
                >
                  Load more lists
                </Button>
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
      <ListEditor open={create} setOpen={setCreate} userId={userId} />
    </Stack>
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
  const [saving, setSaving] = useState(false);
  return (
    <Drawer opened={open} onClose={() => setOpen(false)} title={list ? "Edit list" : "New list"}>
      <Box
        component="form"
        key={list?.id ?? "new"}
        onSubmit={(event) => {
          event.preventDefault();
          if (saving) return;
          const data = new FormData(event.currentTarget),
            title = fieldText(data.get("title")).trim(),
            description = fieldText(data.get("description"));
          if (!title) return;
          setSaving(true);
          void send(
            list
              ? { type: "list.edit", listId: list.id, title, description }
              : { type: "list.create", title, description },
            userId,
          )
            .then(() => {
              setOpen(false);
              notify(list ? "List updated." : "List created.");
            })
            .catch(report)
            .finally(() => setSaving(false));
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Lists are public to MovieFinder members.
          </Text>
          <TextInput
            name="title"
            label="List name"
            required
            maxLength={120}
            defaultValue={list?.title}
            data-autofocus
          />
          <Textarea
            name="description"
            label="Description"
            rows={4}
            maxLength={2000}
            defaultValue={fieldText(list?.data.description ?? "")}
          />
          <Button type="submit" disabled={saving}>
            {list ? "Save changes" : "Create list"}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
export function ListDetail({ userId }: { userId: string }) {
  const { listId } = useParams({ strict: false }) as { listId: string },
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
    bindNavigation(controller.signal, window.location.href);
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
  const move = (itemId: string, beforeId: string | null) =>
    void send({ type: "list.move", listId, itemId, beforeId }, userId).catch(report);
  return (
    <Stack gap="lg">
      <Anchor renderRoot={(props) => <Link {...props} to="/lists" />}>
        <Group gap="xs">
          <ArrowLeft size={16} />
          Back to lists
        </Group>
      </Anchor>
      <PageHeading title={list?.title ?? "List"} />
      <ScrollArea h="4.65rem">
        <Text>{fieldText(list?.data.description)}</Text>
      </ScrollArea>
      <Group gap="sm">
        <Badge variant="light" w="6rem">
          <Group component="span" gap={0} wrap="nowrap">
            <Text component="span" inherit ff="monospace" w="5ch" ta="left">
              {entries.length}
            </Text>
            <Text component="span" inherit>
              titles
            </Text>
          </Group>
        </Badge>
        <Text size="sm" c="dimmed">
          Public list · Changes sync automatically
        </Text>
      </Group>
      <ScrollArea h="8rem">
        <Group gap="sm">
          <Button
            variant="default"
            disabled={!list}
            w="9rem"
            justify="flex-start"
            leftSection={saved ? <Check size={16} /> : <Bookmark size={16} />}
            onClick={() =>
              void send({ type: "list.follow", listId, follow: !saved }, userId).catch(report)
            }
          >
            {saved ? "Saved" : "Save list"}
          </Button>
          <Button
            variant="subtle"
            leftSection={<Copy size={16} />}
            disabled={!list}
            onClick={() =>
              void send({ type: "list.copy", listId }, userId)
                .then(() => notify("List copied."))
                .catch(report)
            }
          >
            Make a copy
          </Button>
          {editable && (
            <Button leftSection={<Plus size={16} />} onClick={() => setAdd(true)}>
              Add titles
            </Button>
          )}
          {owner && (
            <>
              <Button
                variant="default"
                leftSection={<Pencil size={16} />}
                onClick={() => setEdit(true)}
              >
                Edit
              </Button>
              <Button
                variant="default"
                leftSection={<UserPlus size={16} />}
                onClick={() => setInvite(true)}
              >
                Invite members
              </Button>
            </>
          )}
        </Group>
      </ScrollArea>
      <Grid gap="xl">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <TextInput
              aria-label="Search this list"
              placeholder="Search this list"
              leftSection={<Search size={17} />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ScrollArea h="32rem">
              <Stack>
                {filtered.length ? (
                  filtered.map((entry) => {
                    const e = byId.get(fieldText(entry.data.titleId)),
                      index = entries.findIndex((item) => item.id === entry.id),
                      status = statuses.get(fieldText(entry.data.titleId));
                    return (
                      <Paper
                        component="article"
                        key={entry.id}
                        data-item-id={entry.id}
                        className="list-entry"
                        withBorder
                        p="md"
                        bg={hover === entry.id ? "dark.5" : undefined}
                      >
                        <Stack gap="sm">
                          <Group wrap="nowrap" align="flex-start">
                            <Text size="sm" c="dimmed">
                              {index + 1}
                            </Text>
                            {editable && (
                              <ActionIcon
                                aria-label={`Drag to reorder ${e?.title ?? "title"}`}
                                className="list-drag-handle"
                                onPointerDown={(event) => {
                                  drag.current = entry.id;
                                  event.currentTarget.setPointerCapture(event.pointerId);
                                }}
                                onPointerMove={(event) => {
                                  if (!drag.current) return;
                                  setHover(
                                    document
                                      .elementFromPoint(event.clientX, event.clientY)
                                      ?.closest("[data-item-id]")
                                      ?.getAttribute("data-item-id") ?? "",
                                  );
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
                              </ActionIcon>
                            )}
                            <Anchor
                              className="entry-content"
                              renderRoot={(props) => (
                                <Link
                                  {...props}
                                  to="/title/$id"
                                  params={{ id: fieldText(entry.data.titleId) }}
                                />
                              )}
                              c="inherit"
                              underline="hover"
                              flex={1}
                            >
                              <Group wrap="nowrap" align="flex-start">
                                <Box w="3.5rem" miw="3.5rem">
                                  <Poster entity={e} slot="thumb" />
                                </Box>
                                <Stack gap="xs" flex={1} miw={0}>
                                  <Title order={3} h="2.8em" lineClamp={2}>
                                    {e?.title ?? "Title details"}
                                  </Title>
                                  <Text size="sm" c="dimmed">
                                    {e?.year ?? "—"} · {e?.kind === "tv" ? "TV series" : "Movie"}
                                  </Text>
                                  <Stack gap={0} h="3rem">
                                    <Box h="1.5rem">
                                      {status?.seen === true && (
                                        <Badge variant="light" leftSection={<Eye size={10} />}>
                                          Seen
                                        </Badge>
                                      )}
                                    </Box>
                                    <Box h="1.5rem">
                                      {["liked", "meh", "disliked"].includes(
                                        fieldText(status?.sentiment),
                                      ) && (
                                        <Badge variant="light" leftSection={<Heart size={10} />}>
                                          {fieldText(status?.sentiment)}
                                        </Badge>
                                      )}
                                    </Box>
                                  </Stack>
                                  <Text
                                    size="sm"
                                    c="dimmed"
                                    lineClamp={2}
                                    h="3.1em"
                                    visibleFrom="sm"
                                  >
                                    {e?.overview ?? ""}
                                  </Text>
                                </Stack>
                              </Group>
                            </Anchor>
                          </Group>
                          {editable && (
                            <Group justify="flex-end" gap="xs">
                              <ActionIcon
                                aria-label={`Move ${e?.title} up`}
                                disabled={index === 0}
                                onClick={() => move(entry.id, entries[index - 1]?.id ?? null)}
                              >
                                <ArrowUp size={16} />
                              </ActionIcon>
                              <ActionIcon
                                aria-label={`Move ${e?.title} down`}
                                disabled={index === entries.length - 1}
                                onClick={() => move(entry.id, entries[index + 2]?.id ?? null)}
                              >
                                <ArrowDown size={16} />
                              </ActionIcon>
                              <ActionIcon
                                color="red"
                                aria-label={`Remove ${e?.title}`}
                                onClick={() =>
                                  void send(
                                    { type: "list.remove", listId, itemId: entry.id },
                                    userId,
                                  ).catch(report)
                                }
                              >
                                <Trash2 size={16} />
                              </ActionIcon>
                            </Group>
                          )}
                        </Stack>
                      </Paper>
                    );
                  })
                ) : (
                  <Empty title={search ? "No matching titles" : "No titles yet"}>
                    {search ? "Try another search." : "Add a movie or TV show to this list."}
                  </Empty>
                )}
              </Stack>
            </ScrollArea>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack>
            <Title order={2}>Collaborators</Title>
            <Text size="sm" c="dimmed">
              {collaborators.length} members
            </Text>
            <ScrollArea h="12rem">
              <Stack>
                {collaborators.map((member) => {
                  const user = users.find((u) => u.id === member.data.userId);
                  return (
                    <Group key={member.id} justify="space-between" wrap="nowrap">
                      <Anchor
                        renderRoot={(props) => (
                          <Link
                            {...props}
                            to="/profile/$userId"
                            params={{ userId: fieldText(member.data.userId) }}
                          />
                        )}
                        c="inherit"
                      >
                        <Group wrap="nowrap">
                          <Avatar size="sm">{user?.title[0] ?? "?"}</Avatar>
                          <Stack gap={0}>
                            <Text size="sm" truncate>
                              {user?.title ?? "Member"}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {fieldText(member.data.role)}
                            </Text>
                          </Stack>
                        </Group>
                      </Anchor>
                      {owner && member.data.role !== "owner" && (
                        <ActionIcon
                          color="red"
                          aria-label={`Remove ${user?.title} as collaborator`}
                          onClick={() =>
                            void send(
                              {
                                type: "list.member.remove",
                                listId,
                                userId: fieldText(member.data.userId),
                              },
                              userId,
                            ).catch(report)
                          }
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                  );
                })}
              </Stack>
            </ScrollArea>
            <Divider />
            <Title order={2}>Recent edits</Title>
            <ScrollArea h="16rem">
              <Stack>
                {activities
                  .filter((a) => a.data.targetId === listId)
                  .slice(0, 8)
                  .map((a) => (
                    <Stack gap={0} key={a.id}>
                      <ActivityCaption
                        actorId={fieldText(a.data.userId)}
                        actorName={users.find((u) => u.id === a.data.userId)?.title ?? "Member"}
                        action={a.title}
                      />
                      <Text size="xs" c="dimmed">
                        {new Date(fieldText(a.data.createdAt)).toLocaleDateString()}
                      </Text>
                    </Stack>
                  ))}
              </Stack>
            </ScrollArea>
            {editable && (
              <Text size="sm" c="dimmed">
                Drag a handle or use the arrows to reorder titles.
              </Text>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
      {nextPage && (
        <Button
          variant="default"
          onClick={() => void loadSocial("list", listId, nextPage).catch(report)}
        >
          Load more titles
        </Button>
      )}
      <ListEditor open={edit} setOpen={setEdit} userId={userId} list={list} />
      <Drawer opened={invite} onClose={() => setInvite(false)} title="Invite members">
        <Stack>
          <Text size="sm" c="dimmed">
            Invited members can edit this list.
          </Text>
          {invitations
            .filter((i) => i.data.listId === listId && i.data.state === "pending")
            .map((inv) => (
              <Stack key={inv.id} gap="xs">
                <Text>{users.find((u) => u.id === inv.data.userId)?.title ?? "Member"}</Text>
                <Text size="sm" c="dimmed">
                  Invitation pending
                </Text>
                <Button
                  variant="subtle"
                  onClick={() =>
                    void send(
                      { type: "list.member.remove", listId, userId: fieldText(inv.data.userId) },
                      userId,
                    ).catch(report)
                  }
                >
                  Cancel invitation
                </Button>
              </Stack>
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
              <NavLink
                component="button"
                key={u.id}
                label={u.title}
                description={`@${fieldText(u.data.username ?? "member")}`}
                leftSection={<Avatar size="sm">{u.title[0]}</Avatar>}
                rightSection={<UserPlus size={17} />}
                onClick={() =>
                  void send({ type: "list.invite", listId, userId: u.id }, userId)
                    .then(() => {
                      notify(`Invitation sent to ${u.title}.`);
                      setInvite(false);
                    })
                    .catch(report)
                }
              />
            ))}
        </Stack>
      </Drawer>
      <AddTitles
        open={add}
        setOpen={setAdd}
        listId={listId}
        userId={userId}
        existing={entries.map((e) => fieldText(e.data.titleId))}
      />
    </Stack>
  );
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
    bindNavigation(controller.signal, window.location.href);
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
    <Drawer opened={open} onClose={() => setOpen(false)} title="Add titles">
      <Stack>
        <TextInput
          label="Find a title"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search movies and TV shows"
        />
        <ScrollArea h="24rem">
          <Stack>
            {[...movies, ...tv]
              .filter((e) => e.title.toLowerCase().includes(q.toLowerCase()))
              .slice(0, 30)
              .map((e) => (
                <NavLink
                  component="button"
                  key={e.id}
                  disabled={existing.includes(e.id)}
                  aria-disabled={existing.includes(e.id)}
                  label={e.title}
                  description={`${e.year ?? "—"} · ${e.kind === "tv" ? "Series" : "Movie"}`}
                  rightSection={existing.includes(e.id) ? <Check size={17} /> : <Plus size={17} />}
                  onClick={() =>
                    void send({ type: "list.add", listId, titleId: e.id }, userId).catch(report)
                  }
                />
              ))}
          </Stack>
        </ScrollArea>
        <Button
          renderRoot={(props) => <Link {...props} to="/search" />}

          variant="default"
          rightSection={<ArrowUpRight size={15} />}
        >
          Search catalog
        </Button>
      </Stack>
    </Drawer>
  );
}
