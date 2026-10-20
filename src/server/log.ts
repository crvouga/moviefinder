import { record } from "./telemetry";
export const metrics = {
  cacheHit: 0,
  cacheMiss: 0,
  upstreamRequests: 0,
  upstreamRateLimits: 0,
  syncSuccess: 0,
  syncFailure: 0,
  sseConnections: 0,
  replayedEvents: 0,
  queries: 0,
  queryMilliseconds: 0,
};
export function log(
  category: string,
  message: string,
  fields: Record<string, string | number | boolean> = {},
) {
  if (category !== "http") record("log", category, { message, ...fields });
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), category, message, ...fields }),
  );
}
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    message: string,
  ) {
    super(message);
  }
}
