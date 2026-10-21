import {
  feedParams,
  stableSerialize,
  fieldText,
  type Entity,
  type FeedParams,
} from "../shared/contracts";
import {
  discover,
  loadEntity,
  loadSocial,
  getEntity,
  collections,
  collectionsReady,
  queryReady,
} from "./state";
import { prepareGraphArtwork } from "./graph-artwork";
import { compareOrder } from "./components/viewer";
import { entityImages, prepareImage, type SlotName } from "./images";
import { track, span, bindContext, contextFor, telemetryEnabled } from "./telemetry";

function localURL(href: string) {
  const url = new URL(href, window.location.origin);
  return url.origin === window.location.origin ? url : undefined;
}
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
const signature = (p: FeedParams) => stableSerialize({ ...p, cursor: undefined, exclude: [] });
function canPredict() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    !document.hidden && !connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType ?? "")
  );
}

// Optional background preparation warms canonical data and artwork. Route changes never await it.
export function prepareScreen(
  href: string,
  userId: string,
  signal: AbortSignal,
  speculative = false,
) {
  if (telemetryEnabled && !contextFor(signal))
    bindContext(signal, { traceId: crypto.randomUUID() });
  return span("prepare", "screen", () => prepareScreenWork(href, userId, signal, speculative), {
    ...contextFor(signal),
    path: new URL(href, location.origin).pathname,
    speculative,
  });
}
async function prepareScreenWork(
  href: string,
  userId: string,
  signal: AbortSignal,
  speculative = false,
) {
  const url = localURL(href);
  if (!url || !userId || signal.aborted) return;
  const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let read: (() => Promise<string | null>) | undefined;
  let social: Promise<unknown> | undefined;
  switch (path[0]) {
    case undefined: {
      const parsed = feedParams.safeParse(Object.fromEntries(url.searchParams));
      if (parsed.success) read = () => discover(parsed.data, signal, speculative, true);
      break;
    }
    case "title":
      if (path[1]) read = () => loadEntity(path[1]!, signal, speculative, true);
      break;
    case "lists":
      social = path[1]
        ? loadSocial("list", path[1], undefined, signal, speculative)
        : loadSocial("lists", "yours", undefined, signal, speculative);
      break;
    case "profile":
      social = loadSocial("profile", path[1] ?? userId, undefined, signal, speculative);
      break;
    case "activity":
      break;
    case "search": {
      const q = url.searchParams.get("q")?.trim();
      if (q) {
        const parsed = feedParams.safeParse({ q });
        if (parsed.success) read = () => discover(parsed.data, signal, speculative, true);
        social = loadSocial("search", q, undefined, signal, speculative);
      }
      break;
    }
    default:
      return;
  }
  // Reuse known URLs immediately instead of waiting for provider hydration before images start.
  const cachedArtwork = prepareArtwork(path, url, userId, signal, !speculative);
  void cachedArtwork.catch(() => {});
  const [, queryId] = await Promise.all([
    span("prepare", "collections", () => collectionsReady(), contextFor(signal)),
    read?.(),
    social,
  ]);
  signal.throwIfAborted();
  // Preparation can adopt an already-running cache-only request. Upgrade its answer once.
  if (queryId && !queryReady(queryId)) {
    const refreshed = await read?.();
    if (refreshed && !queryReady(refreshed))
      throw new Error("This page couldn’t be prepared. Please try again shortly.");
  }
  await span(
    "prepare",
    "artwork",
    async () => {
      await Promise.all([cachedArtwork, prepareArtwork(path, url, userId, signal, !speculative)]);
    },
    {
      ...contextFor(signal),
      speculative,
    },
  );
}

async function prepareArtwork(
  path: string[],
  url: URL,
  userId: string,
  signal: AbortSignal,
  priority: boolean,
) {
  const artwork: [Entity | undefined, SlotName][] = [];
  const add = (id: string, slot: SlotName) => artwork.push([getEntity(id), slot]);
  if (path[0] === "title" && path[1]) {
    return prepareGraphArtwork([], [path[1]], getEntity, signal, priority);
  } else if (!path[0] || path[0] === "search") {
    const parsed = feedParams.safeParse(
      path[0] === "search"
        ? { q: url.searchParams.get("q") ?? "" }
        : Object.fromEntries(url.searchParams),
    );
    if (parsed.success) {
      const key = signature(parsed.data);
      const pages = [...collections.query.values()]
        .filter(
          (q) => q.id.startsWith("discover:") && signature(q.data.params as FeedParams) === key,
        )
        .sort((a, b) => Number(a.id.split(":").at(-1)) - Number(b.id.split(":").at(-1)));
      const primary = [...new Set(pages.flatMap((q) => ids(q.data.ids)))];
      const position = path[0] ? 0 : Number(sessionStorage.getItem(`feed-position:${key}`) ?? 0);
      for (const id of primary.slice(position, position + (path[0] ? 8 : 2)))
        add(id, path[0] ? "card" : "feed");
    }
  } else if (path[0] === "lists") {
    const membership = new Set(
      [...collections.collaborator.values()]
        .filter((member) => member.data.userId === userId)
        .map((member) => fieldText(member.data.listId)),
    );
    const listIds = path[1]
      ? [path[1]]
      : [...collections.list.values()]
          .filter((list) => list.data.ownerId === userId || membership.has(list.id))
          .slice(0, 4)
          .map((list) => list.id);
    for (const listId of listIds) {
      const items = [...collections.item.values()]
        .filter((item) => item.data.listId === listId)
        .sort(compareOrder);
      for (const item of items.slice(0, path[1] ? 12 : 3))
        add(fieldText(item.data.titleId), "thumb");
    }
  } else if (path[0] === "profile") {
    const id = path[1] ?? userId;
    artwork.push([collections.user.get(id), "avatar"]);
    for (const status of [...collections.status.values()]
      .filter((s) => s.data.userId === id && s.data.sentiment === "liked")
      .slice(0, 8))
      add(fieldText(status.data.titleId), "card");
  }
  await Promise.all(
    artwork.map(([entity, slot]) => prepareImage(entityImages(entity), slot, signal, priority)),
  );
}

export function preloadTitles(ids: string[], userId: string, settle = 450) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (!canPredict()) return;
    track("preload", "titles", { count: Math.min(ids.length, 2) });
    for (const id of ids.slice(0, 2))
      void prepareScreen(`/title/${encodeURIComponent(id)}`, userId, controller.signal, true).catch(
        () => {},
      );
  }, settle);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

// Prediction stays small: the primary navigation once per session and up to two visible
// destinations after scrolling/rendering settles. Intent bypasses the idle delay. Save-Data,
// slow connections and hidden tabs suppress automatic prediction, but never navigation.
export function startNavigationPreloading(userId: string) {
  type Intent = {
    controller: AbortController;
    start?: ReturnType<typeof setTimeout>;
    expiry?: ReturnType<typeof setTimeout>;
    launched: boolean;
  };
  const intents = new Map<HTMLAnchorElement, Intent>();
  const predictions = new Map<string, AbortController>();
  const warmedNavigation = new Set<string>();
  const anchor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  const eligible = (link: HTMLAnchorElement) => {
    const url = localURL(link.href);
    return (
      url &&
      !link.download &&
      (!link.target || link.target === "_self") &&
      !link.hasAttribute("data-no-preload") &&
      /^\/(?:$|title\/|lists(?:\/|$)|profile(?:\/|$)|activity$|search$)/.test(url.pathname) &&
      url.pathname + url.search !== location.pathname + location.search
    );
  };
  const launch = (
    href: string,
    controller: AbortController,
    reason: string,
    speculative = true,
  ) => {
    track("preload", reason, { path: localURL(href)?.pathname ?? "" });
    void prepareScreen(href, userId, controller.signal, speculative).catch(() => {});
  };
  const drop = (link: HTMLAnchorElement) => {
    const intent = intents.get(link);
    if (!intent) return;
    clearTimeout(intent.start);
    clearTimeout(intent.expiry);
    intent.controller.abort();
    intents.delete(link);
  };
  const enter = (event: Event) => {
    if (
      document.hidden ||
      (event instanceof MouseEvent &&
        (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) ||
      (event instanceof PointerEvent && event.type === "pointerdown" && event.button !== 0)
    )
      return;
    const link = anchor(event.target);
    if (!link || !eligible(link)) return;
    let intent = intents.get(link);
    if (!intent) {
      intent = { controller: new AbortController(), launched: false };
      intents.set(link, intent);
    }
    clearTimeout(intent.expiry);
    const current = intent;
    const start = () => {
      clearTimeout(current.start);
      if (current.launched || current.controller.signal.aborted) return;
      current.launched = true;
      launch(link.href, current.controller, "intent", event.type !== "pointerdown");
    };
    if (event.type !== "pointerover") start();
    else if (!intent.start && !intent.launched) intent.start = setTimeout(start, 350);
    intent.expiry = setTimeout(() => drop(link), 20_000);
  };
  const leave = (event: Event) => {
    const link = anchor(event.target);
    if (!link) return;
    const related = (event as MouseEvent | FocusEvent).relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    if (link.contains(document.activeElement) && event.type === "pointerout") return;
    const intent = intents.get(link);
    if (!intent) return;
    clearTimeout(intent.start);
    clearTimeout(intent.expiry);
    intent.start = undefined;
    intent.expiry = setTimeout(() => drop(link), 120);
  };
  let predictionTimer: ReturnType<typeof setTimeout> | undefined;
  let navigating = false;
  const predict = () => {
    if (navigating || !canPredict()) return;
    const visible = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((link) => {
      if (!eligible(link)) return false;
      const rect = link.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < innerHeight &&
        rect.bottom > 0 &&
        rect.left < innerWidth &&
        rect.right > 0
      );
    });
    const navigation = visible.filter(
      (link) => !!link.closest("nav, .sidebar-profile, .mobile-header"),
    );
    for (const link of navigation)
      if (!warmedNavigation.has(link.href)) {
        warmedNavigation.add(link.href);
        const controller = new AbortController();
        predictions.set(link.href, controller);
        launch(link.href, controller, "navigation");
      }
    const candidates = [
      ...new Set(
        visible
          .filter(
            (link) =>
              !navigation.includes(link) &&
              link.matches(
                ".person-card, .title-card, .season-card, .episode-row, .entry-content, .list-card, .activity-target, a[href^='/profile/']",
              ),
          )
          .map((link) => link.href),
      ),
    ].slice(0, 2);
    for (const [href, controller] of predictions)
      if (!candidates.includes(href) && !navigation.some((link) => link.href === href)) {
        controller.abort();
        predictions.delete(href);
      }
    for (const href of candidates)
      if (!predictions.has(href)) {
        const controller = new AbortController();
        predictions.set(href, controller);
        launch(href, controller, "viewport");
      }
  };
  const schedulePrediction = () => {
    clearTimeout(predictionTimer);
    predictionTimer = setTimeout(predict, 500);
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        [...record.addedNodes].some(
          (node) =>
            node instanceof Element && (node.matches("a[href]") || node.querySelector("a[href]")),
        ),
      )
    )
      schedulePrediction();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const events = ["pointerover", "pointerdown", "focusin"] as const;
  events.forEach((type) => document.addEventListener(type, enter, true));
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("focusout", leave, true);
  document.addEventListener("scroll", schedulePrediction, { capture: true, passive: true });
  const visibility = () => {
    if (document.hidden) {
      clearTimeout(predictionTimer);
      for (const link of intents.keys()) drop(link);
      for (const controller of predictions.values()) controller.abort();
      predictions.clear();
      warmedNavigation.clear();
    } else schedulePrediction();
  };
  document.addEventListener("visibilitychange", visibility);
  schedulePrediction();
  const dispose = () => {
    observer.disconnect();
    clearTimeout(predictionTimer);
    for (const link of intents.keys()) drop(link);
    for (const controller of predictions.values()) controller.abort();
    events.forEach((type) => document.removeEventListener(type, enter, true));
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("focusout", leave, true);
    document.removeEventListener("scroll", schedulePrediction, true);
    document.removeEventListener("visibilitychange", visibility);
  };
  return Object.assign(dispose, {
    pause: () => {
      navigating = true;
      clearTimeout(predictionTimer);
    },
    resume: () => {
      navigating = false;
      schedulePrediction();
    },
  });
}
