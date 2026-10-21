import { sqlShape } from "../../shared/telemetry";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { record, telemetryEnabled, traceContext } from "../telemetry";
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () =>
    console.error(
      JSON.stringify({
        level: "error",
        category: "database",
        message: "Idle PostgreSQL connection failed",
      }),
    ),
  );
  if (telemetryEnabled())
    pool.on("connect", (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      // Statement text and duration only. Bound parameters can contain personal data.
      (client as { query: unknown }).query = (...args: unknown[]) => {
        if (!telemetryEnabled()) return original(...args);
        const first = args[0];
        const text = typeof first === "string" ? first : (first as { text?: string })?.text;
        const started = performance.now();
        const trace = traceContext();
        const done = (rows?: number, failed?: boolean) =>
          record("db", "query", {
            ...trace,
            parentId: trace?.spanId,
            spanId: crypto.randomUUID(),
            ms: Math.round((performance.now() - started) * 10) / 10,
            sql: text ? sqlShape(text) : undefined,
            rows,
            failed,
          });
        const callback = args.at(-1);
        const usesCallback = typeof callback === "function";
        if (usesCallback)
          args[args.length - 1] = (...result: unknown[]) => {
            done(
              (result[1] as { rowCount?: number | null } | undefined)?.rowCount ?? undefined,
              !!result[0],
            );
            callback(...result);
          };
        let result: unknown;
        try {
          result = original(...args);
        } catch (error) {
          done(undefined, true);
          throw error;
        }
        if (!usesCallback && result && typeof (result as Promise<unknown>).then === "function")
          (result as Promise<{ rowCount?: number | null }>).then(
            (r) => done(r?.rowCount ?? undefined),
            () => done(undefined, true),
          );
        return result;
      };
    });
  if (telemetryEnabled()) {
    const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
    (pool as { connect: unknown }).connect = (...args: unknown[]) => {
      if (!telemetryEnabled()) return connect(...args);
      const started = performance.now(),
        trace = traceContext();
      const done = (failed = false) =>
        record("db-pool", "acquire", {
          ...trace,
          ms: performance.now() - started,
          running: pool.totalCount - pool.idleCount,
          queued: pool.waitingCount,
          failed,
        });
      const callback = args[0];
      if (typeof callback === "function") {
        return connect((...result: unknown[]) => {
          done(!!result[0]);
          callback(...result);
        });
      }
      const result = connect(...args) as Promise<pg.PoolClient>;
      return result.then(
        (client) => {
          done();
          return client;
        },
        (error) => {
          done(true);
          throw error;
        },
      );
    };
  }
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;
