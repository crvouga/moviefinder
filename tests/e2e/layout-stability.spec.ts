import { expect, test, type Locator, type Page } from "@playwright/test";
import { completeGoogleSignIn } from "../fixtures/google-browser";
import type { QueryResult } from "../../src/shared/contracts";

// Headless Playwright normally hides native scrollbars. Exercise their real
// geometry as well as the persistent Mantine scrollbars inside the application.
test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar,FluentOverlayScrollbar"],
  },
});

async function signIn(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g" },
    }),
  );
  await page.goto("/auth?returnTo=%2Fsearch");
  await completeGoogleSignIn(page, {
    name: "A member with a longer display name",
    email: `stable_${crypto.randomUUID().slice(0, 8)}@example.test`,
  });
  await expect(
    page.getByRole("textbox", { name: "Search movies, series, people, and lists" }),
  ).toBeVisible();
}
async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}
async function observe(page: Page) {
  await page.evaluate(() => {
    const measured = window as unknown as {
      __layoutShifts: {
        value: number;
        sources: {
          tag?: string;
          classes?: string;
          previous: DOMRectReadOnly;
          current: DOMRectReadOnly;
        }[];
      }[];
    };
    measured.__layoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Include recent-input shifts too: the goal is stable controls, not a CLS exemption.
        const shift = entry as PerformanceEntry & {
          value: number;
          sources: {
            node?: Node;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }[];
        };
        measured.__layoutShifts.push({
          value: shift.value,
          sources: shift.sources.map((source) => {
            const node = source.node instanceof Element ? source.node : source.node?.parentElement;
            return {
              tag: node?.tagName,
              classes: node?.getAttribute("class") ?? undefined,
              previous: source.previousRect.toJSON(),
              current: source.currentRect.toJSON(),
            };
          }),
        });
      }
    }).observe({ type: "layout-shift" });
  });
}
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
function holdData(page: Page, pattern: RegExp) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const installed = page.route(pattern, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return { installed, release, released: held };
}

test("page gutters and shell positions stay fixed through overflow, drawers and modals", async ({
  page,
  isMobile,
}) => {
  await signIn(page);
  // Force a real classic scrollbar in Chromium instead of relying on the host's
  // auto-hiding overlay preference. This stylesheet is test-only.
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const css = document.createElement("style");
      css.textContent = "html::-webkit-scrollbar { width: 16px; }";
      document.head.append(css);
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Search movies, series, people, and lists" }),
  ).toBeVisible();
  if (!isMobile)
    expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(16);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
    "scroll",
  );
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
  ).toBe("stable");
  const header = page.getByRole("banner").first();
  const first = await geometry(header);
  for (const path of ["/lists", "/activity", "/title/tmdb%3Amovie%3A550", "/search", "/"]) {
    await page.goto(path);
    await expect(page.locator("#main-content h1")).toBeVisible();
    await settled(page);
    expect(await geometry(header)).toEqual(first);
  }
  const title = page.getByRole("heading", { name: "Discover", exact: true });
  const before = await geometry(title);
  await page.getByRole("button", { name: "Customize feed filters" }).click();
  await expect(page.getByRole("dialog", { name: "Feed filters" })).toBeVisible();
  expect(await geometry(header)).toEqual(first);
  expect(await geometry(title)).toEqual(before);
  const backgroundScroll = await page.evaluate(() => scrollY);
  await page.mouse.move(1, 100);
  await page.mouse.wheel(0, 300);
  await settled(page);
  expect(await page.evaluate(() => scrollY)).toBe(backgroundScroll);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await geometry(title)).toEqual(before);
  await page.getByRole("button", { name: "Save this feed" }).click();
  await expect(page.getByRole("dialog", { name: "Save feed" })).toBeVisible();
  expect(await geometry(title)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await geometry(header)).toEqual(first);
});

test("discovery loading preserves the feed frame and navigation without any layout shifts", async ({
  page,
}) => {
  await signIn(page);
  const held = holdData(page, /\/api\/(?:state|discover)(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto("/");
    const next = page.getByRole("button", { name: "Next title", exact: true });
    await expect(next).toBeVisible();
    const before = await geometry(next);
    await observe(page);
    held.release();
    await expect(page.locator(".swiper-slide-active .slide-title h2")).toBeVisible();
    await settled(page);
    expect(await geometry(next)).toEqual(before);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __layoutShifts: {
                value: number;
                sources: {
                  tag?: string;
                  classes?: string;
                  previous: DOMRectReadOnly;
                  current: DOMRectReadOnly;
                }[];
              }[];
            }
          ).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    held.release();
  }
});

for (const detail of [
  { kind: "movie", id: "tmdb:movie:550", title: "Fight Club", description: "Synopsis" },
  { kind: "person", id: "tmdb:person:819", title: "Edward Norton", description: "Biography" },
]) {
  test(`cold ${detail.kind} detail hydration keeps hero, controls and section frames fixed`, async ({
    page,
  }) => {
    await signIn(page);
    const held = holdData(page, /\/api\/(?:state|titles?|events)(?:[/?]|$)/);
    await held.installed;
    const syntheticPerson = {
      birthday: "1970-01-01",
      deathday: "2070-01-01",
      birthplace:
        "A deliberately long synthetic birthplace used to test truncation, region and country",
      department: "Acting and additional synthetic production credits",
      overview:
        "A synthetic biography paragraph that must scroll inside its reserved viewport without moving surrounding facts, actions or sections. "
          .repeat(25)
          .trim(),
    };
    if (detail.kind === "person")
      await page.route(
        (url) => decodeURIComponent(url.pathname) === `/api/title/${detail.id}`,
        async (route) => {
          await held.released;
          const response = await route.fetch();
          const result = (await response.json()) as QueryResult;
          for (const entity of result.entities)
            if (entity.id === detail.id) {
              const { overview, ...lifeFacts } = syntheticPerson;
              entity.overview = overview;
              entity.data = { ...entity.data, ...lifeFacts };
            }
          await route.fulfill({ response, json: result });
        },
      );
    try {
      await page.goto(`/title/${encodeURIComponent(detail.id)}`);
      const title = page.locator(".detail-intro h1");
      const facts = page.getByRole("region", { name: "Title facts", exact: true });
      const description = page.getByRole("region", { name: detail.description, exact: true });
      await expect(title).toBeVisible();
      await expect(facts).toBeVisible();
      await expect(description).toBeVisible();
      const credits = page.getByRole("tab", { name: "All credits", exact: true });
      if (detail.kind === "person") await expect(credits).toBeVisible();
      await settled(page);
      const frames = page.locator(
        ".detail-hero, .detail-skeleton, .detail-intro, .detail-intro h1, .detail-intro [role=region], .detail-status, [data-data-section]",
      );
      const rectangles = () =>
        frames.evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      const before = await rectangles();
      const creditsBefore = detail.kind === "person" ? await geometry(credits) : undefined;
      await observe(page);
      held.release();
      await expect(title).toHaveText(detail.title);
      await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
      if (detail.kind === "person") {
        for (const value of [
          `Born ${syntheticPerson.birthday}`,
          `Died ${syntheticPerson.deathday}`,
          syntheticPerson.birthplace,
          syntheticPerson.department,
        ])
          await expect(facts.getByText(value, { exact: true })).toBeVisible();
        await expect(description).toHaveText(syntheticPerson.overview);
        await expect
          .poll(() =>
            description.evaluate((element) => element.scrollHeight > element.clientHeight),
          )
          .toBe(true);
      }
      await settled(page);
      expect(await rectangles()).toEqual(before);
      if (creditsBefore) expect(await geometry(credits)).toEqual(creditsBefore);
      expect(
        await page.evaluate(
          () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
        ),
      ).toEqual([]);
    } finally {
      held.release();
    }
  });

  test(`late ${detail.kind} detail artwork cannot move the hero or following content`, async ({
    page,
  }) => {
    await signIn(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/title\//, async (route) => {
      const response = await route.fetch();
      const result = (await response.json()) as QueryResult;
      for (const entity of result.entities)
        if (entity.id === detail.id) entity.poster = `/stable-detail-${detail.kind}.jpg`;
      await route.fulfill({ response, json: result });
    });
    await page.route("https://image.tmdb.org/**", async (route) => {
      await held;
      await route
        .fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="gray"/></svg>',
        })
        .catch(() => {});
    });
    try {
      await page.goto(`/title/${encodeURIComponent(detail.id)}`);
      await expect(page.locator(".detail-intro h1")).toHaveText(detail.title);
      await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
      const artwork = page.locator(
        `.detail-hero img[alt]:not([alt=""])[src$="/stable-detail-${detail.kind}.jpg"]`,
      );
      await expect(artwork).toBeVisible();
      await expect(artwork).toHaveJSProperty("complete", false);
      const hero = page.locator(".detail-hero");
      const status = page.locator(".detail-status");
      const before = { hero: await geometry(hero), status: await geometry(status) };
      await observe(page);
      release();
      await expect(artwork).toHaveJSProperty("complete", true);
      await expect
        .poll(() => artwork.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await settled(page);
      expect({ hero: await geometry(hero), status: await geometry(status) }).toEqual(before);
      expect(
        await page.evaluate(
          () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
        ),
      ).toEqual([]);
    } finally {
      release();
    }
  });
}

test("profile hydration keeps the header, statistics and tabs fixed", async ({ page }) => {
  await signIn(page);
  const held = holdData(page, /\/api\/(?:state|profiles)(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto("/profile");
    const edit = page.getByRole("button", { name: "Edit profile", exact: true });
    await expect(edit).toBeVisible();
    const tab = page.getByRole("tab", { name: "Liked", exact: true });
    await expect(page.locator("[data-screen-preview]")).toHaveCount(0);
    await expect(tab).toBeVisible();
    const before = { edit: await geometry(edit), tab: await geometry(tab) };
    await observe(page);
    held.release();
    await expect(
      page.getByRole("heading", { name: "A member with a longer display name", exact: true }),
    ).toBeVisible();
    await expect(edit).toBeEnabled();
    await settled(page);
    expect({ edit: await geometry(edit), tab: await geometry(tab) }).toEqual(before);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __layoutShifts: {
                value: number;
                sources: {
                  tag?: string;
                  classes?: string;
                  previous: DOMRectReadOnly;
                  current: DOMRectReadOnly;
                }[];
              }[];
            }
          ).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    held.release();
  }
});

test("late artwork and viewer badges leave every result card in the same rectangle", async ({
  page,
}) => {
  await signIn(page);
  let release!: () => void;
  const images = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://image.tmdb.org/**", async (route) => {
    await images;
    await route
      .fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="gray"/></svg>',
      })
      .catch(() => {});
  });
  try {
    await page.goto("/search?q=Fight");
    const card = page
      .locator(".title-card")
      .filter({ has: page.getByRole("heading", { name: "Fight Club", exact: true }) });
    await expect(card).toBeVisible();
    await expect(page.getByText("Search in progress", { exact: false })).toBeHidden();
    const liked = await page.request.post("/api/command", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        type: "status",
        titleId: "tmdb:movie:550",
        sentiment: "liked",
        operationId: crypto.randomUUID(),
      },
    });
    expect(liked.ok()).toBe(true);
    const likedBadge = card.getByText("Liked", { exact: true });
    await expect(likedBadge).toBeVisible();
    const before = await geometry(card);
    const badgeBefore = await geometry(likedBadge);
    await observe(page);
    release();
    await expect(card.locator("img")).toHaveJSProperty("complete", true);
    expect(await geometry(card)).toEqual(before);
    const response = await page.request.post("/api/command", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        type: "status",
        titleId: "tmdb:movie:550",
        seen: true,
        operationId: crypto.randomUUID(),
      },
    });
    expect(response.ok()).toBe(true);
    await expect(card.getByText("Seen", { exact: true })).toBeVisible();
    await expect(card.getByText("Liked", { exact: true })).toBeVisible();
    await settled(page);
    expect(await geometry(card)).toEqual(before);
    expect(await geometry(likedBadge)).toEqual(badgeBefore);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    release();
  }
});

test("live profile edits cannot move the controls or tabs", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile");
  const edit = page.getByRole("button", { name: "Edit profile", exact: true });
  await expect(edit).toBeEnabled();
  const tab = page.getByRole("tab", { name: "Liked", exact: true });
  await expect(page.locator("[data-screen-preview]")).toHaveCount(0);
  await expect(tab).toBeVisible();
  const before = { edit: await geometry(edit), tab: await geometry(tab) };
  await observe(page);
  const response = await page.request.post("/api/command", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: "profile",
      name: "A much longer name that must wrap without moving adjacent controls",
      username: `stable_${crypto.randomUUID().slice(0, 8)}`,
      bio: "A longer profile biography. ".repeat(15),
      image: "",
      operationId: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  await expect(
    page.getByRole("heading", {
      name: "A much longer name that must wrap without moving adjacent controls",
      exact: true,
    }),
  ).toBeVisible();
  await settled(page);
  expect({ edit: await geometry(edit), tab: await geometry(tab) }).toEqual(before);
  expect(
    await page.evaluate(() => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts),
  ).toEqual([]);
});

test("late provider ranking cannot reorder the cached cards already on screen", async ({
  page,
}) => {
  await signIn(page);
  // Populate this member's snapshot through a real command; do not depend on a
  // previous browser case having fetched a matching catalog page.
  const seeded = await page.request.post("/api/command", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: "status",
      titleId: "tmdb:movie:1",
      seen: true,
      operationId: crypto.randomUUID(),
    },
  });
  expect(seeded.ok()).toBe(true);
  const held = holdData(page, /\/api\/discover(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto("/search?q=Test");
    const first = page.locator(".title-card").first();
    await expect(first.getByRole("heading")).toContainText("Test story");
    const firstTitle = await first.getByRole("heading").textContent();
    const before = await geometry(first);
    await observe(page);
    held.release();
    await expect(page.getByRole("heading", { name: "Fight Club", exact: true })).toBeVisible();
    await settled(page);
    await expect(first.getByRole("heading")).toHaveText(firstTitle!);
    expect(await geometry(first)).toEqual(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
    await page.getByRole("button", { name: "Refresh order", exact: true }).click();
    await expect(first.getByRole("heading")).toHaveText("Fight Club");
  } finally {
    held.release();
  }
});

test("cold list hydration cannot move existing actions as permissions arrive", async ({ page }) => {
  await signIn(page);
  const response = await page.request.post("/api/command", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: "list.create",
      title: "Stable list",
      description: "A list with delayed metadata and permissions.",
      operationId: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as { entities: { id: string; kind: string }[] };
  const list = result.entities.find((entity) => entity.kind === "list")!;
  const held = holdData(page, /\/api\/(?:state|lists)(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto(`/lists/${encodeURIComponent(list.id)}`);
    const save = page.getByRole("button", { name: "Save list", exact: true });
    const search = page.getByRole("textbox", { name: "Search this list" });
    await expect(save).toBeVisible();
    const before = { save: await geometry(save), search: await geometry(search) };
    await observe(page);
    held.release();
    await expect(page.getByRole("heading", { name: "Stable list", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add titles", exact: true })).toBeVisible();
    await settled(page);
    expect({ save: await geometry(save), search: await geometry(search) }).toEqual(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    held.release();
  }
});

test("incoming activity waits for Show latest without displacing existing rows", async ({
  page,
}) => {
  await signIn(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const createList = (title: string) =>
    page.request.post("/api/command", {
      headers: { Origin: new URL(page.url()).origin },
      data: { type: "list.create", title, description: "", operationId: crypto.randomUUID() },
    });
  const firstTitle = `Existing activity ${suffix}`;
  const nextTitle = `Incoming activity ${suffix}`;
  expect((await createList(firstTitle)).ok()).toBe(true);
  await page.goto("/activity");
  const first = page.getByRole("link", { name: firstTitle, exact: true });
  await expect(first).toBeVisible();
  const latest = page.getByRole("button", { name: "Show latest", exact: true });
  await expect(latest).toBeDisabled();
  const before = await geometry(first);
  const action = page.locator("article").filter({ has: first }).locator(".activity-caption p");
  const actionBefore = await geometry(action);
  await observe(page);
  const actorName =
    "A member with a substantially longer name that must not move the activity description";
  const renamed = await page.request.post("/api/command", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: "profile",
      name: actorName,
      username: `actor_${suffix}`,
      bio: "",
      image: "",
      operationId: crypto.randomUUID(),
    },
  });
  expect(renamed.ok()).toBe(true);
  await expect(
    page.locator("article").filter({ has: first }).getByRole("link", { name: actorName }).last(),
  ).toBeVisible();
  await settled(page);
  expect(await geometry(first)).toEqual(before);
  expect(await geometry(action)).toEqual(actionBefore);
  expect(
    await page.evaluate(() => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts),
  ).toEqual([]);
  if (await latest.isEnabled()) await latest.click();
  await expect(latest).toBeDisabled();
  await settled(page);
  const incomingBefore = await geometry(first);
  await observe(page);
  expect((await createList(nextTitle)).ok()).toBe(true);
  await expect(latest).toBeEnabled();
  await settled(page);
  expect(await geometry(first)).toEqual(incomingBefore);
  expect(
    await page.evaluate(() => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts),
  ).toEqual([]);
  await latest.click();
  await expect(
    page.locator("article").first().getByRole("link", { name: nextTitle }),
  ).toBeVisible();
  await expect(latest).toBeDisabled();
});

test("cached summaries keep facts and genre links fixed while full details hydrate", async ({
  page,
}) => {
  await signIn(page);
  // A provider summary need not include runtime. Keep the fixture genuinely
  // partial even though this test database already has the full source document.
  await page.route(/\/api\/(?:state|discover)(?:[/?]|$)/, async (route) => {
    const response = await route.fetch();
    const result = (await response.json()) as QueryResult;
    for (const entity of result.entities) delete entity.data.runtime;
    await route.fulfill({ response, json: result });
  });
  const held = holdData(page, /\/api\/(?:titles?|events)(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto("/search?q=Fight");
    const card = page.locator(".title-card").filter({
      has: page.getByRole("heading", { name: "Fight Club", exact: true }),
    });
    await expect(card).toBeVisible();
    await card.click();
    const hero = page.locator(".detail-intro");
    const kind = hero.getByText("Movie", { exact: true });
    const genre = hero.locator('a[href*="genres="]').nth(1);
    await expect(kind).toBeVisible();
    await expect(genre).toBeVisible();
    await expect(hero.getByText("139 min", { exact: true })).toHaveCount(0);
    await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "false");
    await settled(page);
    const before = { kind: await geometry(kind), genre: await geometry(genre) };
    await observe(page);
    held.release();
    await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
    await expect(hero.getByText("139 min", { exact: true })).toBeVisible();
    await settled(page);
    expect({ kind: await geometry(kind), genre: await geometry(genre) }).toEqual(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    held.release();
  }
});

test("permanent scrollbars keep thumb dragging and keyboard scrolling functional", async ({
  page,
}) => {
  await signIn(page);
  for (let number = 1; number <= 10; number++) {
    const response = await page.request.post("/api/command", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        type: "status",
        titleId: `tmdb:movie:${number}`,
        seen: true,
        operationId: crypto.randomUUID(),
      },
    });
    expect(response.ok()).toBe(true);
  }
  const held = holdData(page, /\/api\/discover(?:[/?]|$)/);
  await held.installed;
  try {
    await page.goto("/search?q=Test");
    const viewport = page.getByRole("region", { name: "Movies and TV shows content", exact: true });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    const thumb = page.locator('[data-data-section="Movies and TV shows"] .stable-scroll-thumb');
    await expect(thumb).toBeVisible();
    const box = (await thumb.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await viewport.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
    await settled(page);
    await expect(viewport).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await settled(page);
    await observe(page);
    held.release();
    await expect(page.getByRole("heading", { name: "Fight Club", exact: true })).toBeVisible();
    await settled(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    held.release();
  }
});

test("detail failures and retry keep feedback, actions and following sections fixed", async ({
  page,
}) => {
  await signIn(page);
  const seeded = await page.request.post("/api/command", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: "status",
      titleId: "tmdb:movie:550",
      seen: true,
      operationId: crypto.randomUUID(),
    },
  });
  expect(seeded.ok()).toBe(true);
  let deny!: () => void;
  const pending = new Promise<void>((resolve) => {
    deny = resolve;
  });
  let fail = true;
  await page.route(/\/api\/titles?(?:[/?]|$)/, async (route) => {
    if (fail) {
      await pending;
      await route
        .fulfill({ status: 503, json: { error: "Temporary fixture failure" } })
        .catch(() => {});
    } else await route.continue().catch(() => {});
  });
  const events = holdData(page, /\/api\/events(?:[/?]|$)/);
  await events.installed;
  try {
    await page.goto("/title/tmdb%3Amovie%3A550");
    await expect(page.locator(".detail-intro h1")).toHaveText("Fight Club");
    const status = page.locator(".detail-status");
    const next = page.getByRole("heading", { name: "Videos", exact: true });
    await expect(status).toContainText("Fetching details");
    await status.scrollIntoViewIfNeeded();
    await settled(page);
    const before = { status: await geometry(status), next: await geometry(next) };
    await observe(page);
    deny();
    const retry = status.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await settled(page);
    expect({ status: await geometry(status), next: await geometry(next) }).toEqual(before);
    const action = await geometry(retry);
    expect(action.y).toBeGreaterThanOrEqual(before.status.y);
    expect(action.y + action.height).toBeLessThanOrEqual(before.status.y + before.status.height);
    fail = false;
    await retry.click();
    await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, { timeout: 10000 });
    await settled(page);
    expect({ status: await geometry(status), next: await geometry(next) }).toEqual(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __layoutShifts: unknown[] }).__layoutShifts,
      ),
    ).toEqual([]);
  } finally {
    deny();
    events.release();
  }
});
