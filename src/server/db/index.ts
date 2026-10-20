import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { record, telemetryEnabled } from "../telemetry";
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
        const first = args[0];
        const text = typeof first === "string" ? first : (first as { text?: string })?.text;
        const started = performance.now();
        const done = (rows?: number, failed?: boolean) =>
          record("db", "query", {
            ms: Math.round((performance.now() - started) * 10) / 10,
            sql: text?.replace(/\s+/g, " ").slice(0, 160),
            rows,
            failed,
          });
        const result = original(...args);
        if (result && typeof (result as Promise<unknown>).then === "function")
          (result as Promise<{ rowCount?: number | null }>).then(
            (r) => done(r?.rowCount ?? undefined),
            () => done(undefined, true),
          );
        return result;
      };
    });
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;
