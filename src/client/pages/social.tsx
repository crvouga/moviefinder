import { bindNavigation } from "../telemetry";
import { loadSocial } from "../state";
import { fieldText } from "../../shared/contracts";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Pencil, ArrowUpRight, LogOut, Check, UserPlus, Bookmark } from "lucide-react";
import { authClient, useEntities, send, report, encodeParams, stopSync } from "../state";
import type { FeedParams, Entity } from "../../shared/contracts";
import { DataSection } from "../components/data-section";
import { useStableOrder } from "../stable-order";
import {
  ActivityCaption,
  PageHeading,
  Empty,
  TitleCard,
  ShowMore,
  usePaging,
} from "../components/common";
import { useTitles, useUsers } from "../components/viewer";
import { ListCard } from "./lists";
import { Image } from "../components/image";
import {
  Anchor,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  Image as MantineImage,
  NavLink,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
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
    ),
    ordered = useStableOrder("activity", sorted);
  return (
    <Stack gap="lg">
      <PageHeading title="Activity">
        <Button variant="default" disabled={ordered.isCurrent} onClick={ordered.refresh}>
          Show latest
        </Button>
      </PageHeading>
      <DataSection title="Invitations" height="14rem">
        <Stack>
          {!pending.length && <Text c="dimmed">No pending invitations.</Text>}
          {pending.map((inv) => (
            <Paper withBorder p="md" className="invitation" key={inv.id}>
              <Stack>
                <Text h="3.1em" lineClamp={2}>
                  {users.get(fieldText(inv.data.invitedBy))?.title ?? "A member"} invited you to
                  collaborate
                </Text>
                <Text fw={500} h="3.1em" lineClamp={2}>
                  {listsById.get(fieldText(inv.data.listId))?.title ?? "Shared list"}
                </Text>
                <Group>
                  <Button
                    onClick={() =>
                      void send({ type: "invitation.accept", invitationId: inv.id }, userId).catch(
                        report,
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    variant="default"
                    onClick={() =>
                      void send({ type: "invitation.decline", invitationId: inv.id }, userId).catch(
                        report,
                      )
                    }
                  >
                    Decline
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </DataSection>
      <DataSection title="Recent activity" height="32rem">
        {activities.length ? (
          <Stack component="section" gap="md">
            {ordered.rows.slice(0, paging.shown).map((a) => {
              const u = users.get(fieldText(a.data.userId)),
                targetId = fieldText(a.data.targetId),
                target = titles.get(targetId) ?? listsById.get(targetId);
              return (
                <Group component="article" key={a.id} wrap="nowrap" align="flex-start">
                  <Avatar
                    renderRoot={(props) => (
                      <Link
                        {...props}
                        to="/profile/$userId"
                        params={{ userId: fieldText(a.data.userId) }}
                      />
                    )}
                    aria-label={u?.title ?? "Member profile"}
                  >
                    {u?.title[0] ?? "?"}
                  </Avatar>
                  <Stack gap="xs" flex={1} miw={0}>
                    <ActivityCaption
                      actorId={fieldText(a.data.userId)}
                      actorName={u?.title ?? "Member"}
                      action={a.title}
                    />
                    <Box h="1.55rem">
                      {target && (
                        <Anchor
                          className="activity-target"
                          lineClamp={1}
                          renderRoot={(props) => (
                            <Link
                              {...props}
                              to={target.kind === "list" ? "/lists/$listId" : "/title/$id"}
                              params={
                                target.kind === "list" ? { listId: targetId } : { id: targetId }
                              }
                            />
                          )}
                        >
                          {target.title}
                        </Anchor>
                      )}
                    </Box>
                    <Text size="xs" c="dimmed">
                      {new Date(fieldText(a.data.createdAt)).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Stack>
                </Group>
              );
            })}
            <ShowMore total={sorted.length} paging={paging} />
          </Stack>
        ) : (
          <Empty title="No activity yet">
            Title updates and list changes from members you follow will appear here.
          </Empty>
        )}
      </DataSection>
    </Stack>
  );
}
export function ProfileHeader({
  user,
  own,
  followed = false,
  onEdit,
  onFollow,
}: {
  user?: Entity;
  own: boolean;
  followed?: boolean;
  onEdit?: () => void;
  onFollow?: () => void;
}) {
  return (
    <Paper component="header" withBorder p="lg" bg="dark.8">
      <Group align="flex-start" justify="space-between">
        <Group
          align="flex-start"
          wrap="nowrap"
          w={{ base: "100%", sm: "calc(100% - 14rem)" }}
          miw={0}
        >
          <Avatar size="xl">
            <Image
              images={user?.poster ? [{ path: user.poster, role: "poster" }] : []}
              slot="avatar"
              alt={user?.title ?? "Profile"}
              fallback={user?.title[0] ?? "U"}
            />
          </Avatar>
          <Stack gap="xs" flex={1} miw={0}>
            <Title order={1} h="2.5em" lineClamp={2}>
              {user?.title ?? "Profile"}
            </Title>
            <Text c="dimmed" h="1.55em" truncate>
              @{fieldText(user?.data.username ?? "member")}
            </Text>
            <ScrollArea h="4.65rem">
              <Text>{fieldText(user?.data.bio ?? "")}</Text>
            </ScrollArea>
          </Stack>
        </Group>
        {own ? (
          <Button
            variant="default"
            disabled={!user || !onEdit}
            w="12rem"
            leftSection={<Pencil size={16} />}
            onClick={onEdit}
          >
            Edit profile
          </Button>
        ) : (
          <Button
            variant={followed ? "default" : "filled"}
            w="12rem"
            justify="flex-start"
            leftSection={followed ? <Check size={16} /> : <UserPlus size={16} />}
            disabled={!user || !onFollow}
            onClick={onFollow}
          >
            {followed ? "Following" : "Follow"}
          </Button>
        )}
      </Group>
    </Paper>
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
    [saving, setSaving] = useState(false),
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
    bindNavigation(controller.signal, window.location.href);
    void loadSocial("profile", userId, undefined, controller.signal).catch((error) => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [userId]);
  const savedFeeds = feeds.filter((f) => f.data.userId === userId);
  return (
    <Stack gap="lg">
      <ProfileHeader
        user={user}
        own={own}
        followed={followed}
        onEdit={() => setEdit(true)}
        onFollow={() =>
          void send({ type: "user.follow", userId, follow: !followed }, currentUserId).catch(report)
        }
      />
      <SimpleGrid cols={3} maw="24rem">
        {[
          [tags.filter((s) => s.data.seen).length, "Seen"],
          [tags.filter((s) => s.data.sentiment === "liked").length, "Liked"],
          [ownedLists.length, "Lists"],
        ].map(([count, label]) => (
          <Stack gap={0} key={label}>
            <Text fw={600} size="xl">
              {count}
            </Text>
            <Text size="sm" c="dimmed">
              {label}
            </Text>
          </Stack>
        ))}
      </SimpleGrid>
      <Tabs value={tab} onChange={(value) => setTab(value ?? "liked")}>
        <Tabs.List>
          {[
            ["liked", "Liked"],
            ["seen", "Seen"],
            ["meh", "Meh"],
            ["disliked", "Disliked"],
            ["lists", "Lists"],
            ...(own ? [["feeds", "Saved feeds"]] : []),
          ].map(([value, label]) => (
            <Tabs.Tab key={value} value={value!}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {["liked", "seen", "meh", "disliked", "lists", ...(own ? ["feeds"] : [])]
          .filter((value) => value !== tab)
          .map((value) => (
            <Tabs.Panel key={value} value={value}>
              {null}
            </Tabs.Panel>
          ))}
        <Tabs.Panel value={tab} pt="lg">
          <ScrollArea h="32rem">
            <Stack>
              {tab === "lists" ? (
                ownedLists.length ? (
                  <SimpleGrid cols={{ base: 1, xs: 2, lg: 3 }}>
                    {ownedLists.map((l) => (
                      <ListCard key={l.id} list={l} />
                    ))}
                  </SimpleGrid>
                ) : (
                  <Empty title="No lists yet">Public lists will appear here.</Empty>
                )
              ) : tab === "feeds" ? (
                savedFeeds.length ? (
                  <Stack>
                    {savedFeeds.map((f) => (
                      <NavLink
                        key={f.id}
                        renderRoot={(props) => (
                          <Link
                            {...props}
                            to="/"
                            search={encodeParams(f.data.params as FeedParams)}
                          />
                        )}
                        label={f.title}
                        leftSection={<Bookmark size={18} />}
                        rightSection={<ArrowUpRight size={18} />}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Empty title="No saved feeds">
                    Save a set of filters from Discover to return to it later.
                  </Empty>
                )
              ) : titles.length ? (
                <SimpleGrid cols={{ base: 2, xs: 3, md: 4, lg: 5 }}>
                  {titles.slice(0, paging.shown).map((e) => (
                    <TitleCard key={e.id} entity={e} />
                  ))}
                </SimpleGrid>
              ) : (
                <Empty title="No titles yet">Titles marked in Discover will appear here.</Empty>
              )}
              {!["lists", "feeds"].includes(tab) && (
                <ShowMore total={titles.length} paging={paging} />
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
      {nextPage && (
        <Button
          variant="default"
          onClick={() => void loadSocial("profile", userId, nextPage).catch(report)}
        >
          Load more
        </Button>
      )}
      {own && (
        <Group>
          <Button
            variant="subtle"
            leftSection={<LogOut size={16} />}
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
            Sign out
          </Button>
        </Group>
      )}
      <Divider />
      <Stack component="section" gap="sm">
        <Title order={2}>Data sources</Title>
        <Anchor
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noreferrer"
          aria-label="The Movie Database"
        >
          <MantineImage src="/tmdb-logo.svg" alt="The Movie Database" w={65} h={47} fit="contain" />
        </Anchor>
        <Text size="sm" c="dimmed">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </Text>
        <Text size="sm" c="dimmed">
          Streaming availability is provided by JustWatch through TMDB.
        </Text>
      </Stack>
      <Drawer opened={edit} onClose={() => setEdit(false)} title="Edit profile">
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving) return;
            const data = new FormData(event.currentTarget);
            setSaving(true);
            void send(
              {
                type: "profile",
                name: fieldText(data.get("name")),
                username: fieldText(data.get("username")),
                bio: fieldText(data.get("bio")),
                image: fieldText(data.get("image")),
              },
              currentUserId,
            )
              .then(() => setEdit(false))
              .catch(report)
              .finally(() => setSaving(false));
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Your profile is public to MovieFinder members.
            </Text>
            <TextInput
              name="name"
              label="Display name"
              required
              maxLength={100}
              defaultValue={user?.title}
            />
            <TextInput
              name="username"
              label="Username"
              description="3–30 letters, numbers, or underscores"
              required
              pattern="[a-zA-Z0-9_]{3,30}"
              defaultValue={fieldText(user?.data.username ?? "")}
            />
            <Textarea
              name="bio"
              label="About you"
              rows={3}
              maxLength={500}
              defaultValue={fieldText(user?.data.bio ?? "")}
            />
            <TextInput
              name="image"
              label="Avatar URL"
              type="url"
              placeholder="https://"
              defaultValue={fieldText(user?.data.image ?? "")}
            />
            <Button type="submit" disabled={saving}>
              Save profile
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </Stack>
  );
}
