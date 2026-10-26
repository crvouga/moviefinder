import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Anchor,
  AspectRatio,
  ScrollArea,
  SimpleGrid,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Drawer,
  Group,
  NavLink,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  Heart,
  Eye,
  Meh,
  ThumbsDown,
  Plus,
  Check,
  Bookmark,
  Star,
  ArrowUpRight,
} from "lucide-react";
import type { Entity } from "../../shared/contracts";
import { send, report } from "../state";
import { entityImages, type SlotName } from "../images";
import { Image } from "./image";
import { useSaveLists, useViewerStatus } from "./viewer";
export const titleHref = (id: string) => `/title/${encodeURIComponent(id)}`;

// Actor metadata can resolve separately from the event itself. Keep its link
// independent of the action so a longer name cannot push or hide that action.
export function ActivityCaption({
  actorId,
  actorName,
  action,
}: {
  actorId: string;
  actorName: string;
  action: string;
}) {
  return (
    <Stack className="activity-caption" gap={0} fz="sm" h="3.1em">
      <Anchor
        renderRoot={(props) => (
          <Link {...props} to="/profile/$userId" params={{ userId: actorId }} />
        )}
        size="sm"
        fw={600}
        h="1.55em"
        truncate
      >
        {actorName}
      </Anchor>
      <Text size="sm" h="1.55em" truncate>
        {action}
      </Text>
    </Stack>
  );
}

// Product artwork keeps the existing source selection, sizing and telemetry contract.
export function Poster({
  entity,
  slot = "card",
  priority = false,
}: {
  entity?: Entity;
  slot?: SlotName;
  priority?: boolean;
}) {
  return (
    <AspectRatio
      ratio={slot === "still" ? 16 / 9 : 2 / 3}
      bg="dark.6"
      c="dimmed"
      bdrs="md"
      maw="100%"
    >
      <Image
        images={entityImages(entity)}
        slot={slot}
        alt={
          entity
            ? `${entity.title} ${entity.kind === "person" ? "portrait" : entity.kind === "episode" ? "still" : "poster"}`
            : ""
        }
        priority={priority}
        fallback={
          <Center>
            <Stack align="center" gap="xs" p="xs">
              <ThemeIcon
                size="xl"
                variant="light"
                color={entity?.kind === "person" ? "cyan" : "yellow"}
              >
                <Text component="span" size="xl" lh={1} aria-hidden="true">
                  {entity?.kind === "person" ? "⭐" : entity?.kind === "tv" ? "📺" : "🍿"}
                </Text>
              </ThemeIcon>
              <Text size="xs" ta="center">
                No image
              </Text>
            </Stack>
          </Center>
        }
      />
    </AspectRatio>
  );
}
export const TitleCard = memo(function TitleCard({ entity }: { entity: Entity }) {
  const status = useViewerStatus(entity.id);
  return (
    <Card
      renderRoot={(props) => <Link {...props} to="/title/$id" params={{ id: entity.id }} />}

      className="title-card"
      c="inherit"
      padding="sm"
    >
      <Card.Section
        h="var(--mantine-spacing-xs)"
        bg={entity.kind === "person" ? "cyan.4" : entity.kind === "tv" ? "violet.4" : "yellow.4"}
        mb="sm"
      />
      <Stack gap="xs">
        <Poster entity={entity} />
        <Title order={3} ff="var(--mantine-font-family)" h="2.8em" lineClamp={2}>
          {entity.title}
        </Title>
        <Text size="sm" c="dimmed" h="1.55em" lineClamp={1}>
          {entity.year ?? "—"} ·{" "}
          {entity.kind === "tv" ? "TV series" : entity.kind === "person" ? "Person" : "Movie"}
        </Text>
        <SimpleGrid cols={1} spacing={0} verticalSpacing={0} h="4.5rem">
          <Box h="1.5rem">
            {!!entity.rating && (
              <Badge size="sm" variant="filled" leftSection={<Star size={11} />}>
                {entity.rating.toFixed(1)}
              </Badge>
            )}
          </Box>
          <Box h="1.5rem">
            {status?.seen && (
              <Badge size="sm" color="cyan" variant="light" leftSection={<Eye size={11} />}>
                Seen
              </Badge>
            )}
          </Box>
          <Box h="1.5rem">
            {status?.sentiment === "liked" && (
              <Badge size="sm" color="pink" variant="light" leftSection={<Heart size={11} />}>
                Liked
              </Badge>
            )}
          </Box>
        </SimpleGrid>
      </Stack>
    </Card>
  );
});
// Bound DOM work while retaining the canonical collections as the source of truth.
export function usePaging(key: string, size = 48) {
  const [state, set] = useState({ key, shown: size });
  const shown = state.key === key ? state.shown : size;
  return { shown, more: () => set({ key, shown: shown + size }) };
}
export function ShowMore({
  total,
  paging,
}: {
  total: number;
  paging: ReturnType<typeof usePaging>;
}) {
  return total > paging.shown ? (
    <Button variant="default" onClick={paging.more}>
      <Group component="span" gap="xs" wrap="nowrap">
        <Text component="span" inherit>
          Show more
        </Text>
        <Text component="span" inherit ff="monospace" w="6ch" ta="left">
          ({total - paging.shown})
        </Text>
      </Group>
    </Button>
  ) : null;
}
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack align="center" gap="sm" py="xl" role="status">
      <ThemeIcon size="xl" variant="gradient">
        <Text component="span" size="xl" lh={1} aria-hidden="true">
          🍿
        </Text>
      </ThemeIcon>
      <Title order={2} ta="center">
        {title}
      </Title>
      <Text c="dimmed" ta="center" maw="32rem">
        {children}
      </Text>
    </Stack>
  );
}
export function Tags({
  entity,
  userId,
  compact = false,
}: {
  entity?: Entity;
  userId: string;
  compact?: boolean;
}) {
  const status = useViewerStatus(entity?.id ?? ""),
    [add, setAdd] = useState(false);
  const selected = fieldText(status?.sentiment ?? "unrated");
  const toggle = (value: "liked" | "meh" | "disliked") =>
    entity &&
    void send(
      { type: "status", titleId: entity.id, sentiment: selected === value ? "unrated" : value },
      userId,
    ).catch(report);
  return (
    <>
      <Group gap="xs" aria-label="Title actions">
        <Button
          size={compact ? "sm" : undefined}
          variant={status?.seen ? "filled" : "light"}
          color="cyan"
          disabled={!entity}
          aria-label="Mark as seen"
          aria-pressed={!!status?.seen}
          leftSection={<Eye size={16} />}
          onClick={() =>
            entity &&
            void send({ type: "status", titleId: entity.id, seen: !status?.seen }, userId).catch(
              report,
            )
          }
        >
          Seen
        </Button>
        {(
          [
            { value: "liked", label: "Like", icon: Heart, color: "pink" },
            { value: "meh", label: "Meh", icon: Meh, color: "violet" },
            { value: "disliked", label: "Dislike", icon: ThumbsDown, color: "orange" },
          ] as const
        ).map(({ value, label, icon: Icon, color }) => (
          <Button
            key={value}
            size={compact ? "sm" : undefined}
            variant={selected === value ? "filled" : "light"}
            color={color}
            disabled={!entity}
            aria-label={label}
            aria-pressed={selected === value}
            leftSection={<Icon size={16} />}
            onClick={() => toggle(value)}
          >
            {label}
          </Button>
        ))}
        <Button
          size={compact ? "sm" : undefined}
          variant="light"
          color="yellow"
          disabled={!entity}
          aria-label="Add to list"
          leftSection={<Plus size={16} />}
          onClick={() => setAdd(true)}
        >
          Add to list
        </Button>
      </Group>
      {entity && <AddToList entity={entity} userId={userId} open={add} setOpen={setAdd} />}
    </>
  );
}
export function AddToList({
  entity,
  userId,
  open,
  setOpen,
}: {
  entity: Entity;
  userId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <Drawer opened={open} onClose={() => setOpen(false)} title="Add to list">
      <Stack>
        <Text c="dimmed">{entity.title}</Text>
        {open && <ListPicker entity={entity} userId={userId} setOpen={setOpen} />}
      </Stack>
    </Drawer>
  );
}
function ListPicker({
  entity,
  userId,
  setOpen,
}: {
  entity: Entity;
  userId: string;
  setOpen: (v: boolean) => void;
}) {
  const editable = useSaveLists(),
    paging = usePaging(entity.id);
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    createdList = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);
  return (
    <Stack>
      <ScrollArea h="24rem">
        <Stack>
          {editable.slice(0, paging.shown).map(({ list, titleIds, count }) => {
            const exists = titleIds.has(entity.id);
            return (
              <NavLink
                key={list.id}
                component="button"
                disabled={exists}
                aria-disabled={exists}
                label={list.title}
                description={`${count} titles`}
                leftSection={<Bookmark size={20} />}
                rightSection={exists ? <Check size={18} /> : <Plus size={18} />}
                onClick={() =>
                  void send({ type: "list.add", listId: list.id, titleId: entity.id }, userId)
                    .then(() => setOpen(false))
                    .catch(report)
                }
              />
            );
          })}
          {!editable.length && (
            <Text c="dimmed">No editable lists. Create a list to save this title.</Text>
          )}
          <ShowMore total={editable.length} paging={paging} />
        </Stack>
      </ScrollArea>
      {creating ? (
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving || !name.trim()) return;
            setSaving(true);
            void (async () => {
              if (!createdList.current) {
                const result = await send(
                  { type: "list.create", title: name.trim(), description: "" },
                  userId,
                );
                createdList.current = result.entities.find((e) => e.kind === "list")?.id;
              }
              if (!createdList.current) throw new Error("The list could not be created.");
              await send(
                { type: "list.add", listId: createdList.current, titleId: entity.id },
                userId,
              );
              setOpen(false);
            })()
              .catch(report)
              .finally(() => setSaving(false));
          }}
        >
          <Stack>
            <TextInput
              ref={input}
              label="List name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              readOnly={saving || !!createdList.current}
            />
            <Group>
              <Button type="submit" disabled={saving || !name.trim()}>
                Create and add
              </Button>
              <Button
                type="button"
                variant="subtle"
                disabled={saving}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </Box>
      ) : (
        <Button
          variant="default"
          leftSection={<Plus size={16} />}
          onClick={() => setCreating(true)}
        >
          Create a list
        </Button>
      )}
    </Stack>
  );
}
export function PageHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Group
      component="header"
      justify="space-between"
      align="center"
      gap="md"
      mih="2.75rem"
      wrap="nowrap"
    >
      <ThemeIcon size="xl" variant="gradient" aria-hidden="true" visibleFrom="xs">
        <Text component="span" size="xl" lh={1}>
          {title === "Discover"
            ? "🍿"
            : title === "Search"
              ? "🔎"
              : title === "Lists"
                ? "🎟️"
                : title === "Activity"
                  ? "💬"
                  : "🎬"}
        </Text>
      </ThemeIcon>
      <Title order={1} h="2.5em" lineClamp={2} flex={1} miw={0}>
        {title}
      </Title>
      {children}
    </Group>
  );
}
export function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Anchor href={href} target="_blank" rel="noreferrer">
      <Group component="span" gap="xs">
        {children}
        <ArrowUpRight size={15} aria-hidden="true" />
      </Group>
    </Anchor>
  );
}
