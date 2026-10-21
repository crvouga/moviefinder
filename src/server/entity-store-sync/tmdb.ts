import { z } from "zod";
import { metrics } from "../log";
import { record, timed } from "../telemetry";
export class UpstreamError extends Error {
  constructor(
    public status: number,
    public retryAfter = 0,
  ) {
    super(`Catalog provider returned HTTP ${status}`);
  }
}
export const upstreamPage = z
  .object({
    page: z.number().int().optional(),
    total_pages: z.number().int().optional(),
    results: z.array(z.object({ id: z.number().int().positive() }).passthrough()),
  })
  .passthrough();
export function createTmdb(
  token: string,
  transport: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
) {
  let lastRequest = 0,
    blockedUntil = 0;
  return async function request(
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (blockedUntil > Date.now()) throw new UpstreamError(429, blockedUntil - Date.now());
    const delay = Math.max(0, lastRequest + 140 - Date.now());
    lastRequest = Date.now() + delay;
    if (delay)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    metrics.upstreamRequests++;
    const started = performance.now();
    const res = await transport(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    record("upstream-headers", `GET ${path}`, {
      status: res.status,
      ms: Math.round((performance.now() - started) * 10) / 10,
      waited: delay,
    });
    if (!res.ok) {
      const retry = res.headers.get("Retry-After");
      const retryAfter = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now()) || 0
        : 0;
      if (res.status === 429) {
        metrics.upstreamRateLimits++;
        blockedUntil = Date.now() + Math.max(1000, retryAfter);
      }
      throw new UpstreamError(res.status, retryAfter);
    }
    return timed("parse", "provider", async () =>
      z.record(z.string(), z.unknown()).parse(await res.json()),
    );
  };
}
export type Tmdb = ReturnType<typeof createTmdb>;
