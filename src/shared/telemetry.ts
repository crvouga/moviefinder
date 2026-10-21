// A shared privacy boundary: diagnostics contain shapes and timings, never user values.
export type TelemetryFields = Record<string, string | number | boolean | null | undefined>;
export type TraceContext = {
  traceId: string;
  requestId?: string;
  spanId?: string;
  parentId?: string;
};
export const isTraceId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const staticPaths = new Set(
  "movie tv person season episode trending all day week credits combined_credits watch providers recommendations api auth get-session sign-in sign-up email sign-out health ready metrics auth-options state events telemetry discover title titles command lists profile activity search people followers following invitations accept decline password reset-password request-password-reset callback google social profiles list users social-search".split(
    " ",
  ),
);
const dynamic = new Set(["title", "profile", "profiles", "lists", "list", "users"]);
export function routeName(value: string) {
  const parts = (value.split(/[?#]/)[0] ?? "/").split("/").filter(Boolean);
  const offset = parts[0] === "api" ? 1 : 0;

  return (
    "/" +
    parts
      .map((part, index) =>
        index === offset + 1 && dynamic.has(parts[offset]!)
          ? ":id"
          : staticPaths.has(part)
            ? part
            : ":id",
      )
      .join("/")
  );
}
const sqlTables = new Set(
  "user session account verification source_entity query_cache sync_job sync_checkpoint title_status list list_item collaborator invitation follow saved_feed activity event operation".split(
    " ",
  ),
);
export function sqlShape(text: string) {
  const clean = text.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\$([a-zA-Z_]\w*)?\$[\s\S]*?\$\1\$/g,
    "?",
  );
  const operation =
    clean
      .trim()
      .match(
        /^(select|insert|update|delete|begin|commit|rollback|savepoint|release|with|truncate|alter|create|set)/i,
      )?.[1]
      ?.toUpperCase() ?? "OTHER";
  const tables = [...clean.matchAll(/"?moviefinder"?\."?([a-z_]+)"?/gi)]
    .map((m) => m[1]!)
    .filter((name) => sqlTables.has(name));
  // A previously sanitized shape must remain stable when reading older files or receiving events.
  if (/^[A-Z]+(?: [a-z_,]+)?$/.test(clean) && clean.startsWith(operation)) {
    for (const table of (clean.split(" ")[1] ?? "").split(","))
      if (sqlTables.has(table)) tables.push(table);
  }
  return `${operation}${tables.length ? " " + [...new Set(tables)].join(",") : ""}`;
}
const numbers = new Set(
  "ms at status bytes entities rows size count running queued settled speculative started failed value blocking scriptMs base loopP50 loopP99 loopMax rssMb heapMb domNodes events removed connections cursor waited queueMs decodeMs downloadMs buffered dropped retries supported duration startTime transferBytes encodedBytes decodedBytes cacheHit adopted delayMs attempt retryMs timeoutMs hidden foreground".split(
    " ",
  ),
);
const labels = new Set(
  "phase scope target failed resource initiator outcome metric support".split(" "),
);
export function safeFields(fields: TelemetryFields): TelemetryFields {
  const out: TelemetryFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      (numbers.has(key) || /^n_[a-z_]+$/.test(key)) &&
      (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
    )
      out[key] = value;
    else if (
      ["traceId", "requestId", "spanId", "parentId", "workId", "page", "key"].includes(key) &&
      isTraceId(value)
    )
      out[key] = value;
    else if (key === "failed" && typeof value === "string")
      out.failed = /^(aborted|AbortError|TimeoutError|TypeError|SyntaxError|Error)$/.test(value)
        ? value
        : "error";
    else if (key === "sql" && typeof value === "string") out.sql = sqlShape(value);
    else if (key === "path" && typeof value === "string") out.path = routeName(value);
    else if (
      labels.has(key) &&
      typeof value === "string" &&
      /^(mount|update|nested-update|list|lists|profile|search|button|a|input|form|unknown|Error|TypeError|AbortError|TimeoutError|SyntaxError|error|aborted|cancelled|success|failed|timeout|fallback|image|img|script|css|link|fetch|xmlhttprequest|other|navigation|body|supported|unsupported|first-paint|first-contentful-paint|lcp|cls|interaction|resolved|paint|headers|decode|download|longtask|long-animation-frame|event|layout-shift|largest-contentful-paint|resource|paint)$/.test(
        value,
      )
    )
      out[key] = value;
  }
  return out;
}
const eventNames = new Set(
  "cache display main click pointerdown pointerup keydown keyup keypress mousedown mouseup touchstart touchend input submit user genre load size task long sample batch open reset replay close state query acquire settled enqueue run retry outcome preload ready discover entity social titles screen code collections artwork interest prepare cancel wait request join start complete failed intent viewport navigation feed uncaught rejection support first-paint first-contentful-paint lcp shift body provider commit event sync error database boot first movie tv person season episode credit list item collaborator invitation follow status profile query activity saved_feed operation".split(
    " ",
  ),
);

export function safeName(kind: string, name: string) {
  if (["http", "fetch", "upstream", "upstream-headers"].includes(kind)) {
    const match = name.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (.*)$/);
    return match
      ? `${match[1]} ${routeName(match[2]!.startsWith("/") ? match[2]! : "/" + match[2])}`
      : "request";
  }
  if (kind === "route" || kind === "navigation")
    return name.startsWith("/")
      ? routeName(name)
      : /^(start|resolved|paint|interrupted)$/.test(name)
        ? name
        : "event";
  return eventNames.has(name) ? name : "event";
}

const eventKinds = new Set(
  "page longtask frame interaction layout fetch error runtime stall route navigation content graph pool preload load snapshot sync merge sse prepare image observer vital resource http db db-pool job job-wait upstream upstream-headers parse log render transport".split(
    " ",
  ),
);
export const safeKind = (kind: string) => (eventKinds.has(kind) ? kind : "unknown");
