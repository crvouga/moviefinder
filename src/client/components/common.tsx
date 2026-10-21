import { fieldText } from "../../shared/contracts";
import { memo, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Film,
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
import { Button } from "./ui/button";
import { Sheet } from "./ui/dialog";
import { useSaveLists, useViewerStatus } from "./viewer";
export const titleHref = (id: string) => `/title/${encodeURIComponent(id)}`;
export function Poster({
  entity,
  slot = "card",
  priority = false,
  className = "",
}: {
  entity?: Entity;
  slot?: SlotName;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`poster ${className}`}>
      <Image
        images={entityImages(entity)}
        slot={slot}
        alt={entity ? `${entity.title} poster` : ""}
        priority={priority}
        fallback={
          <div className="poster-fallback">
            <Film size={44} />
            <span>{entity?.title ?? "Your next great watch"}</span>
          </div>
        }
      />
    </div>
  );
}
export const TitleCard = memo(function TitleCard({ entity }: { entity: Entity }) {
  const status = useViewerStatus(entity.id);
  return (
    <Link to="/title/$id" params={{ id: entity.id }} className="title-card">
      <Poster entity={entity} />
      {(status?.seen || status?.sentiment === "liked") && (
        <span className="card-status">
          {status?.seen === true && <Eye size={12} aria-label="Seen" />}
          {status?.sentiment === "liked" && <Heart size={12} aria-label="Liked" />}
        </span>
      )}
      <h3>{entity.title}</h3>
      <p>
        {entity.year ?? "—"} <span>·</span>{" "}
        {entity.kind === "tv" ? "Series" : entity.kind === "person" ? "Person" : "Film"}
        {!!entity.rating && (
          <>
            <Star size={11} />
            {entity.rating.toFixed(1)}
          </>
        )}
      </p>
    </Link>
  );
});
// Hundreds of cards cost far more than they help. Reveal a page at a time; `key` restarts it.
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
    <Button variant="outline" className="show-more" onClick={paging.more}>
      Show more ({total - paging.shown} more)
    </Button>
  ) : null;
}
export function Empty({
  title,
  children,
  icon = "✦",
}: {
  title: string;
  children: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Tags({
  entity,
  userId,
  compact = false,
}: {
  entity: Entity;
  userId: string;
  compact?: boolean;
}) {
  const status = useViewerStatus(entity.id),
    [add, setAdd] = useState(false);
  const selected = fieldText(status?.sentiment ?? "unrated");
  const toggle = (value: "liked" | "meh" | "disliked") =>
    void send(
      { type: "status", titleId: entity.id, sentiment: selected === value ? "unrated" : value },
      userId,
    ).catch(report);
  return (
    <>
      <div className={`tag-controls ${compact ? "compact" : ""}`}>
        <button
          aria-label="Mark as seen"
          aria-pressed={!!status?.seen}
          className={status?.seen ? "selected" : ""}
          onClick={() =>
            void send({ type: "status", titleId: entity.id, seen: !status?.seen }, userId).catch(
              report,
            )
          }
        >
          <Eye />
          <span>Seen</span>
        </button>
        <button
          aria-label="Like"
          aria-pressed={selected === "liked"}
          className={selected === "liked" ? "selected liked" : ""}
          onClick={() => toggle("liked")}
        >
          <Heart />
          <span>Love it</span>
        </button>
        <button
          aria-label="Meh"
          aria-pressed={selected === "meh"}
          className={selected === "meh" ? "selected" : ""}
          onClick={() => toggle("meh")}
        >
          <Meh />
          <span>Meh</span>
        </button>
        <button
          aria-label="Dislike"
          aria-pressed={selected === "disliked"}
          className={selected === "disliked" ? "selected" : ""}
          onClick={() => toggle("disliked")}
        >
          <ThumbsDown />
          <span>Not for me</span>
        </button>
        <button aria-label="Add to list" onClick={() => setAdd(true)}>
          <Plus />
          <span>Add to list</span>
        </button>
      </div>
      <AddToList entity={entity} userId={userId} open={add} setOpen={setAdd} />
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
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Save for a good night"
      description={entity.title}
    >
      <ListPicker entity={entity} userId={userId} setOpen={setOpen} />
    </Sheet>
  );
}
// The shared derived picker view is already ready when the sheet opens.
function ListPicker({
  entity,
  userId,
  setOpen,
}: {
  entity: Entity;
  userId: string;
  setOpen: (v: boolean) => void;
}) {
  const editable = useSaveLists();
  const paging = usePaging(entity.id);
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const createdList = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);
  return (
    <div className="sheet-body list-picker">
      {editable.slice(0, paging.shown).map(({ list, titleIds, count }) => {
        const exists = titleIds.has(entity.id);
        return (
          <button
            key={list.id}
            disabled={exists}
            onClick={() =>
              void send({ type: "list.add", listId: list.id, titleId: entity.id }, userId)
                .then(() => setOpen(false))
                .catch(report)
            }
          >
            <span className="list-icon">
              <Bookmark />
            </span>
            <span>
              {list.title}
              <small>{count} titles</small>
            </span>
            {exists ? <Check /> : <Plus />}
          </button>
        );
      })}
      <ShowMore total={editable.length} paging={paging} />
      {creating ? (
        <form
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
          <label>
            List name
            <input
              ref={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              readOnly={saving || !!createdList.current}
            />
          </label>
          <div className="sheet-actions">
            <Button type="submit" disabled={saving || !name.trim()}>
              Create and add
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus size={16} />
          Create a list
        </Button>
      )}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
export function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="external-link">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
