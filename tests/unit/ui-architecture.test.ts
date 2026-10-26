import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../..");
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? files(resolve(directory, entry.name))
          : [resolve(directory, entry.name)],
      ),
    )
  ).flat();
}

test("browser UI has one Mantine theme/provider and no parallel styling or primitives", async () => {
  const paths = await files(resolve(root, "src/client"));
  const sources = await Promise.all(
    paths
      .filter((path) => /\.[tj]sx?$/.test(path))
      .map(async (path) => ({ path: relative(root, path), source: await readFile(path, "utf8") })),
  );
  for (const { path, source } of sources) {
    expect(source, path).not.toMatch(/<(?:button|input|select|textarea|dialog)\b/);
    expect(source, path).not.toMatch(/\b(?:style|styles|classNames|unstyled)\s*=/);
    expect(source, path).not.toMatch(
      /<ScrollArea(?:\.Autosize)?\b[^>]*\btype=["'](?:auto|hover|scroll|never)["']/,
    );
    expect(source, path).not.toMatch(/offsetScrollbars\s*=\s*["']present["']/);
    expect(source, path).not.toMatch(/window\.(?:prompt|confirm|alert)\s*\(/);
    if (path !== "src/client/theme.ts")
      expect(source, path).not.toMatch(/["']#[\da-fA-F]{3,8}["']/);
    const imports = [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    for (const imported of imports.filter((name) => !name.startsWith("."))) {
      expect(imported, `${path}: unapproved browser dependency`).toMatch(
        /^(?:react(?:-dom)?(?:\/|$)|@mantine\/(?:core|hooks|dates|notifications)(?:\/|$)|@tanstack\/|lucide-react$|swiper(?:\/|$)|zod$|better-auth(?:\/|$)|hono\/client$|fractional-indexing$)/,
      );
    }
    if (path !== "src/client/providers.tsx") expect(source, path).not.toMatch(/<MantineProvider\b/);
    if (path !== "src/client/theme.ts") expect(source, path).not.toMatch(/\bcreateTheme\s*\(/);
  }
  expect(
    paths
      .filter((path) => /\.(?:css|scss|sass|less)$/.test(path))
      .map((path) => relative(root, path)),
  ).toEqual(["src/client/interactions.css"]);
  const css = await readFile(resolve(root, "src/client/interactions.css"), "utf8");
  expect(css).not.toMatch(/!important|\.mantine-|@media|@import/);
  expect(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((match) =>
      match[1]!.trim(),
    ),
  ).toEqual([
    "html",
    ".stable-scroll-thumb::before",
    ".list-drag-handle",
    ".skip-link",
    ".skip-link:not(:focus)",
  ]);
  const providers = sources.find(({ path }) => path === "src/client/providers.tsx")!.source;
  expect(providers.match(/<MantineProvider\b/g)).toHaveLength(1);
  expect(sources.find(({ path }) => path === "src/client/main.tsx")!.source).toContain(
    "<Providers>",
  );
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(dependencies))
    expect(name).not.toMatch(
      /tailwind|radix|shadcn|class-variance|^clsx$|^@(?:mui|chakra-ui|emotion|ant-design)\//,
    );
  expect(
    new Set(
      Object.entries(pkg.dependencies)
        .filter(([name]) => name.startsWith("@mantine/"))
        .map(([, version]) => version),
    ).size,
  ).toBe(1);
});
