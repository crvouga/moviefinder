// MovieFinder owns exactly one PostgreSQL schema inside a database shared with other apps.
export const DATABASE_SCHEMA = "moviefinder";

// Atlas reads search_path from the URL: with it, only this schema is inspected and migrated.
// Without it Atlas treats the whole shared database as its target and refuses to apply.
export function schemaScopedUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.searchParams.set("search_path", DATABASE_SCHEMA);
  return url.toString();
}
