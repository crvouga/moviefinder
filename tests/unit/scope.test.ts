import { expect, it } from "vite-plus/test";
import { schemaScopedUrl } from "../../src/server/db/scope";

it("scopes Atlas to the moviefinder schema and keeps the rest of the URL", () => {
  const url = new URL(schemaScopedUrl("postgres://user:pw@db.example:5432/shared?sslmode=require"));
  expect(url.searchParams.get("search_path")).toBe("moviefinder");
  expect(url.searchParams.get("sslmode")).toBe("require");
  expect(url.pathname).toBe("/shared");
});

it("replaces a caller-supplied search_path", () => {
  const url = new URL(schemaScopedUrl("postgres://u:p@h/db?search_path=public"));
  expect(url.searchParams.getAll("search_path")).toEqual(["moviefinder"]);
});
