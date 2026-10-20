import { feedParams } from "../shared/contracts";
import { discover, loadEntity, loadSocial, loadTitles, getEntity } from "./state";
import { screenModules } from "./screen-modules";
import { track } from "./telemetry";

function localURL(href: string) {
  const url = new URL(href, window.location.origin);
  return url.origin === window.location.origin ? url : undefined;
}

// Route loaders await the first cache read; speculation performs a single read. Both paths merge
// into the same collections and join the same cancellable HTTP requests.
export async function prepareScreen(
  href: string,
  userId: string,
  signal: AbortSignal,
  speculative = false,
) {
  const url = localURL(href);
  if (!url || !userId || signal.aborted) return;
  const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let read: (() => Promise<string | null>) | undefined;
  let code: Promise<unknown>;
  let social: Promise<unknown> | undefined;
  switch (path[0]) {
    case undefined: {
      code = screenModules.discover();
      const parsed = feedParams.safeParse(Object.fromEntries(url.searchParams));
      if (parsed.success) read = () => discover(parsed.data, signal, speculative);
      break;
    }
    case "title":
      code = screenModules.details();
      if (path[1]) read = () => loadEntity(path[1]!, signal, speculative);
      break;
    case "lists":
      code = screenModules.lists();
      social = path[1]
        ? loadSocial("list", path[1], undefined, signal, speculative)
        : loadSocial("lists", "yours", undefined, signal, speculative);
      break;
    case "profile":
      code = screenModules.social();
      social = loadSocial("profile", path[1] ?? userId, undefined, signal, speculative);
      break;
    case "activity":
      code = screenModules.social();
      break;
    case "search": {
      code = screenModules.search();
      const q = url.searchParams.get("q")?.trim();
      if (q) {
        const parsed = feedParams.safeParse({ q });
        if (parsed.success) read = () => discover(parsed.data, signal, speculative);
        social = loadSocial("search", q, undefined, signal, speculative);
      }
      break;
    }
    default:
      return;
  }
  // Speculation performs one read. Server hydration is durable and shared, and live updates
  // arrive over SSE, so browsers never poll to follow coverage.
  await Promise.all([code, read?.(), social]);
}

function warmImages(href: string, signal: AbortSignal) {
  const url = localURL(href);
  if (!url?.pathname.startsWith("/title/")) return;
  const entity = getEntity(decodeURIComponent(url.pathname.slice("/title/".length)));
  if (!entity) return;
  const images: HTMLImageElement[] = [];
  for (const [path, size] of [
    [entity.poster, "w500"],
    [entity.backdrop, "w1280"],
  ] as const) {
    if (!path) continue;
    const image = new Image();
    image.fetchPriority = "low";
    if (size === "w500" && !path.startsWith("https://")) {
      image.sizes = "(max-width: 600px) 90vw, 420px";
      image.srcset = ["w342", "w500", "w780"]
        .map((s) => `https://image.tmdb.org/t/p/${s}${path} ${s.slice(1)}w`)
        .join(", ");
    }
    image.src = path.startsWith("https://") ? path : `https://image.tmdb.org/t/p/${size}${path}`;
    images.push(image);
  }
  const cancel = () =>
    images.forEach((image) => {
      image.removeAttribute("srcset");
      image.removeAttribute("src");
    });
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
}

// Discovery warms the title being looked at and the next one in a single request, plus artwork
// for what follows. Nothing starts until the feed has rested, so swiping quickly costs nothing.
export function preloadTitles(ids: string[], settle = 400) {
  const controller = new AbortController();
  const start = setTimeout(() => {
    track("preload", "titles", { count: ids.length });
    void screenModules.details().catch(() => {});
    for (const id of ids) warmImages(`/title/${encodeURIComponent(id)}`, controller.signal);
    void loadTitles(ids.slice(0, 2), controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        for (const id of ids) warmImages(`/title/${encodeURIComponent(id)}`, controller.signal);
      })
      .catch(() => {});
  }, settle);
  return () => {
    clearTimeout(start);
    controller.abort();
  };
}

// One session-scoped owner for pointer, keyboard and press intent. Only a link the person is
// actually aiming at is warmed; nothing is predicted from what happens to be on screen.
export function startNavigationPreloading(userId: string) {
  const intents = new Map<
    HTMLAnchorElement,
    { controller: AbortController; timer?: ReturnType<typeof setTimeout> }
  >();
  const anchor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  const eligible = (link: HTMLAnchorElement) => {
    const url = localURL(link.href);
    return (
      url &&
      !link.download &&
      (!link.target || link.target === "_self") &&
      !link.hasAttribute("data-no-preload") &&
      url.pathname !== "/auth" &&
      /^\/(?:$|title\/|lists(?:\/|$)|profile(?:\/|$)|activity$|search$)/.test(url.pathname) &&
      url.pathname + url.search !== location.pathname + location.search
    );
  };
  const launch = (href: string, controller: AbortController) => {
    track("preload", "intent", { href });
    warmImages(href, controller.signal);
    void prepareScreen(href, userId, controller.signal, true)
      .then(() => {
        if (!controller.signal.aborted) warmImages(href, controller.signal);
      })
      .catch(() => {
        /* Speculative errors must not interrupt the current screen. Navigation retries. */
      });
  };
  const drop = (link: HTMLAnchorElement) => {
    const intent = intents.get(link);
    if (!intent) return;
    clearTimeout(intent.timer);
    intent.controller.abort();
    intents.delete(link);
  };
  const releaseIntent = (link: HTMLAnchorElement) => {
    const intent = intents.get(link);
    if (!intent) return;
    clearTimeout(intent.timer);
    // A brief gap permits leave -> pointerdown/click to transfer ownership without restarting.
    intent.timer = setTimeout(() => drop(link), 120);
  };
  const enter = (event: Event) => {
    if (
      document.hidden ||
      (event instanceof MouseEvent &&
        (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey))
    )
      return;
    if (event instanceof PointerEvent && event.type === "pointerdown" && event.button !== 0) return;
    const link = anchor(event.target);
    if (!link || !eligible(link)) return;
    const existing = intents.get(link);
    if (existing) {
      clearTimeout(existing.timer);
      // Hovering schedules a start; press and focus mean the decision is made.
      if (event.type !== "pointerover" && !existing.controller.signal.aborted)
        existing.timer = setTimeout(() => drop(link), 20_000);
      return;
    }
    const controller = new AbortController();
    const intent: { controller: AbortController; timer?: ReturnType<typeof setTimeout> } = {
      controller,
    };
    intents.set(link, intent);
    // Moving across a grid must not start a request per link; a pause of a moment does.
    const delay = event.type === "pointerover" ? 90 : 0;
    const start = setTimeout(() => {
      if (!controller.signal.aborted) launch(link.href, controller);
    }, delay);
    controller.signal.addEventListener("abort", () => clearTimeout(start), { once: true });
    // Touch/press intent has no reliable leave event. Never retain it indefinitely.
    intent.timer = setTimeout(() => drop(link), 20_000);
  };
  const leave = (event: Event) => {
    const link = anchor(event.target);
    if (!link) return;
    const related = (event as MouseEvent | FocusEvent).relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    if (link.contains(document.activeElement) && event.type === "pointerout") return;
    releaseIntent(link);
  };
  const events = ["pointerover", "pointerdown", "focusin"] as const;
  events.forEach((type) => document.addEventListener(type, enter, true));
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("focusout", leave, true);
  const visibility = () => {
    if (document.hidden) for (const link of intents.keys()) drop(link);
  };
  document.addEventListener("visibilitychange", visibility);
  return () => {
    for (const link of intents.keys()) drop(link);
    events.forEach((type) => document.removeEventListener(type, enter, true));
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("focusout", leave, true);
    document.removeEventListener("visibilitychange", visibility);
  };
}
