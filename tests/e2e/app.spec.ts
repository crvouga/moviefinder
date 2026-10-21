import { test, expect, type Page } from "@playwright/test";
async function register(page: Page, destination = "/") {
  await page.goto(destination);
  await expect(page).toHaveURL(/\/auth/);
  await page.getByRole("button", { name: /Make yourself at home/ }).click();
  const suffix = crypto.randomUUID().slice(0, 8);
  await page.getByLabel("Display name", { exact: true }).fill("Cinema Friend");
  await page.getByLabel("Username", { exact: true }).fill(`friend_${suffix}`);
  await page.getByLabel("Email address").fill(`friend_${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("a-strong-browser-test-password");
  await page.getByRole("button", { name: "Create your account" }).click();
  if (destination === "/") {
    await expect(page.getByRole("heading", { name: "Find your next obsession." })).toBeVisible();
    await expect(page.locator(".discovery-slide").first()).toBeVisible();
  } else
    await expect(page).toHaveURL(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
test("registration, persistent session, discovery, tagging, details, and lists", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page);
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toBeVisible();
  const slide = page.locator(".swiper-slide-active");
  const title = await slide.locator("h2").textContent();
  await slide.getByRole("button", { name: "Like", exact: true }).click();
  await expect(slide.getByRole("button", { name: "Like", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await slide.getByRole("button", { name: "Mark as seen" }).click();
  await expect(slide.getByRole("button", { name: "Mark as seen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Find your next obsession." })).toBeVisible();
  await expect(
    page.locator(".swiper-slide-active").getByRole("button", { name: "Like", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `test-results/${info.project.name}-discover.png`, fullPage: true });
  await page.locator(".swiper-slide-active .slide-title").click();
  await expect(page.locator(".detail-intro h1")).toHaveText(title!);
  await expect(page.getByRole("button", { name: "Like", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("The little details.")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toHaveText(title!);
  await page.goto("/lists");
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await page.getByLabel("List name").fill("A very good movie night");
  await page.getByLabel("A few words").fill("Our next shared watch.");
  await page.getByRole("button", { name: "Create your list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A very good movie night" })).toBeVisible();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "A very good movie night" }) })
    .click();
  await page.getByRole("button", { name: "Add titles", exact: true }).click();
  await page.getByLabel("Find a title", { exact: true }).fill("Fight");
  await page.getByRole("button", { name: /Fight Club/ }).click();
  await page.getByLabel("Find a title", { exact: true }).fill("");
  await page.getByRole("button", { name: /Test story 1 1999/ }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".list-entry")).toHaveCount(2);
  await page.getByRole("button", { name: "Move Test story 1 up", exact: true }).click();
  await expect(page.locator(".list-entry").first()).toContainText("Test story 1");
  await page.reload();
  await expect(page.locator(".list-entry").first()).toContainText("Test story 1");
  await page.screenshot({ path: `test-results/${info.project.name}-list.png`, fullPage: true });
  expect(errors).toEqual([]);
  expect(await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("add-to-list form stays responsive while typing, creating, closing and reopening", async ({
  page,
}) => {
  const nativeDialogs: string[] = [];
  const errors: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page);
  const slide = page.locator(".swiper-slide-active");
  const initialTitle = await slide.locator("h2").textContent();
  const drawer = page.getByRole("dialog", { name: "Save for a good night" });
  await slide.getByRole("button", { name: "Add to list" }).click();
  await drawer.getByRole("button", { name: "Create a list", exact: true }).click();
  expect(nativeDialogs).toEqual([]);
  const name = drawer.getByRole("textbox", { name: "List name", exact: true });
  await name.pressSequentially("A responsive movie night", { delay: 20 });
  await expect(name).toHaveValue("A responsive movie night");
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "Create and add", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();
  await slide.getByRole("button", { name: "Add to list" }).click();
  const saved = drawer.getByRole("button", { name: /A responsive movie night/ });
  await expect(saved).toBeDisabled();
  await expect(saved).toContainText("1 titles");
  await drawer.getByRole("button", { name: "Create a list", exact: true }).click();
  await name.fill("Cancel this draft");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(slide.locator("h2")).toHaveText(initialTitle!);
  await slide.locator(".slide-title").click();
  await expect(page.locator(".detail-intro h1")).toHaveText(initialTitle!);
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(saved).toBeDisabled();
  await drawer.getByRole("button", { name: "Create a list", exact: true }).click();
  await name.fill("Detail page draft");
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(page.getByRole("button", { name: "Like", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(nativeDialogs).toEqual([]);
  expect(errors).toEqual([]);
});
test("advances through virtualized posters and restores the selected title after navigation", async ({
  page,
  isMobile,
}) => {
  await register(page);
  const active = page.locator(".swiper-slide-active .slide-title h2");
  await expect(active).toBeVisible();
  const presented = new Set([await active.textContent()]);
  const touch = isMobile ? await page.context().newCDPSession(page) : undefined;
  try {
    for (let index = 0; index < 7; index++) {
      const previous = await active.textContent();
      const stage = page.locator(".discovery-swiper");
      const box = await stage.boundingBox();
      expect(box).not.toBeNull();
      const x = box!.x + box!.width * 0.5;
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y: box!.y + box!.height * 0.45 }],
        });
        for (let step = 1; step <= 8; step++) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            // Cross half a slide so a slower gesture also completes under CI load.
            touchPoints: [{ x, y: box!.y + box!.height * (0.45 - step * 0.08) }],
          });
        }
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(x, box!.y + box!.height * 0.5);
        await page.mouse.wheel(0, box!.height);
      }
      await expect(active).not.toHaveText(previous!);
      const next = await active.textContent();
      expect(presented.has(next)).toBe(false);
      presented.add(next);
      expect(await page.locator(".swiper-slide").count()).toBeLessThanOrEqual(6);
      // Let Swiper finish its visual transition before the next physical gesture.
      await expect(stage.locator(".swiper-wrapper")).toHaveCSS("transition-duration", "0s");
    }
    const selected = await active.textContent();
    await page.locator(".swiper-slide-active .slide-title").click();
    await expect(page.locator(".detail-intro h1")).toHaveText(selected!);
    await page.goBack();
    await expect(active).toHaveText(selected!);
  } finally {
    await touch?.detach();
  }
});
test("restores an authenticated deep link and supports TV, seasons, and episodes", async ({
  page,
}) => {
  await register(page, "/title/tmdb%3Atv%3A1399");
  await expect(page.getByRole("heading", { name: "Game of Thrones", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Season 1/ }).click();
  await expect(page.getByRole("heading", { name: "Season 1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Winter Is Coming/ }).click();
  await expect(page.getByRole("heading", { name: "Winter Is Coming", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /View season/ })).toBeVisible();
});
test("searches catalog and users, filters discovery, and edits a public profile", async ({
  page,
}) => {
  await register(page);
  await page.goto("/search");
  await page
    .getByRole("textbox", { name: "Search movies, series, people, and lists" })
    .fill("Fight");
  await expect(page.getByRole("heading", { name: "Fight Club", exact: true })).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "TV shows", exact: true }).click();
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toHaveText("Game of Thrones");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("The Film Friend");
  await page.getByLabel("About you").fill("One more episode. Always.");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Film Friend", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("One more episode. Always.", { exact: true })).toBeVisible();
});
test("two authenticated collaborators receive edits and recover after a disconnect", async ({
  page,
  browser,
}) => {
  await register(page);
  const second = await browser.newContext();
  const friend = await second.newPage();
  try {
    await register(friend);
    const session = await (await friend.request.get("/api/auth/get-session")).json();
    const invoke = async (p: Page, value: Record<string, unknown>) => {
      const r = await p.request.post("/api/command", {
        headers: { Origin: "http://127.0.0.1:5188" },
        data: { ...value, operationId: crypto.randomUUID() },
      });
      expect(r.ok()).toBe(true);
      return r.json();
    };
    const created = await invoke(page, {
      type: "list.create",
      title: `Shared night ${crypto.randomUUID().slice(0, 5)}`,
      description: "Two editors, one good list.",
    });
    const listId = created.entities.find((e: { kind: string }) => e.kind === "list").id;
    const invitation = await invoke(page, { type: "list.invite", listId, userId: session.user.id });
    await invoke(friend, {
      type: "invitation.accept",
      invitationId: invitation.entities.find((e: { kind: string }) => e.kind === "invitation").id,
    });
    await page.goto(`/lists/${listId}`);
    await friend.goto(`/lists/${listId}`);
    await expect(friend.getByRole("button", { name: "Add titles", exact: true })).toBeVisible();
    await Promise.all([
      invoke(page, { type: "list.add", listId, titleId: "tmdb:movie:550" }),
      invoke(friend, { type: "list.add", listId, titleId: "tmdb:tv:1399" }),
    ]);
    await expect(page.locator(".list-entry")).toHaveCount(2);
    await expect(friend.locator(".list-entry")).toHaveCount(2);
    await second.setOffline(true);
    await invoke(page, { type: "list.add", listId, titleId: "tmdb:movie:1" });
    await expect(page.locator(".list-entry")).toHaveCount(3);
    await second.setOffline(false);
    await expect(friend.locator(".list-entry")).toHaveCount(3, { timeout: 15000 });
  } finally {
    await second.close();
  }
});
test("composes mobile-friendly filters and keeps optimistic state consistent after a rejected command", async ({
  page,
}) => {
  await register(page);
  await page.getByRole("button", { name: "Customize feed filters" }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByLabel("Min. rating", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Find my next watch", exact: true }).click();
  await expect(page).toHaveURL(/ratingMin=8/);
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toBeVisible();
  const like = page
    .locator(".swiper-slide-active")
    .getByRole("button", { name: "Like", exact: true });
  await page.route("**/api/command", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test permission denied" }),
    }),
  );
  await like.click();
  await expect(page.getByRole("status")).toContainText("Test permission denied");
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await page.unroute("**/api/command");
});
test("recovers canonical collections after a temporary bootstrap failure", async ({ page }) => {
  let failures = 0;
  await page.route("**/api/state", (route) => {
    if (failures++ === 0)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary test database outage" }),
      });
    return route.continue();
  });
  await register(page);
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toBeVisible();
  expect(failures).toBeGreaterThan(1);
  await page
    .locator(".swiper-slide-active")
    .getByRole("button", { name: "Like", exact: true })
    .click();
  await expect(
    page.locator(".swiper-slide-active").getByRole("button", { name: "Like", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("persists saved feeds, public list copies, and collaboration invitations through the UI", async ({
  page,
  browser,
}) => {
  await register(page);
  await page.getByRole("button", { name: "Customize feed filters" }).click();
  page.once("dialog", (dialog) => dialog.accept("My evening picks"));
  await page.getByRole("button", { name: "Save feed", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Saved feeds", exact: true }).click();
  await expect(page.getByRole("link", { name: "My evening picks", exact: true })).toBeVisible();
  await page.goto("/lists");
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await page.getByLabel("List name").fill("A shared UI collection");
  await page.getByRole("button", { name: "Create your list", exact: true }).click();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "A shared UI collection", exact: true }) })
    .click();
  const listId = new URL(page.url()).pathname.split("/").at(-1)!;
  const copied = page.waitForResponse(
    (r) => r.url().endsWith("/api/command") && r.request().postDataJSON()?.type === "list.copy",
  );
  await page.getByRole("button", { name: "Make a copy", exact: true }).click();
  expect((await copied).ok()).toBe(true);
  const current = await (await page.request.get("/api/state")).json();
  expect(
    current.entities.some(
      (e: { kind: string; title: string }) =>
        e.kind === "list" && e.title === "A shared UI collection (copy)",
    ),
  ).toBe(true);
  const second = await browser.newContext();
  const friend = await second.newPage();
  try {
    await register(friend);
    const session = await (await friend.request.get("/api/auth/get-session")).json();
    await page.reload();
    await page.getByRole("button", { name: "Invite friends", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: `@${session.user.username}` })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await friend.goto("/activity");
    await expect(
      friend.locator(".invitation").getByText("A shared UI collection", { exact: true }),
    ).toBeVisible();
    const accepted = friend.waitForResponse(
      (r) =>
        r.url().endsWith("/api/command") &&
        r.request().postDataJSON()?.type === "invitation.accept",
    );
    await friend.getByRole("button", { name: "Accept", exact: true }).click();
    expect((await accepted).ok()).toBe(true);
    const state = await (await friend.request.get("/api/state")).json();
    expect(
      state.entities.some(
        (e: { kind: string; data: Record<string, unknown> }) =>
          e.kind === "collaborator" &&
          e.data.listId === listId &&
          e.data.userId === session.user.id,
      ),
    ).toBe(true);
  } finally {
    await second.close();
  }
});
test("submits recovered command intents even when their optimistic values already match the snapshot", async ({
  page,
}) => {
  await register(page);
  const session = await (await page.request.get("/api/auth/get-session")).json(),
    operationId = crypto.randomUUID();
  const payload = {
    type: "status",
    titleId: "tmdb:movie:1",
    seen: true,
    operationId: crypto.randomUUID(),
  };
  expect(
    (
      await page.request.post("/api/command", {
        headers: { Origin: "http://127.0.0.1:5188" },
        data: payload,
      })
    ).ok(),
  ).toBe(true);
  await page.evaluate(
    ({ userId, operationId }) =>
      localStorage.setItem(
        `moviefinder:commands:${userId}`,
        JSON.stringify([{ type: "status", titleId: "tmdb:movie:1", seen: true, operationId }]),
      ),
    { userId: session.user.id, operationId },
  );
  const replayed = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/command") && r.request().postDataJSON()?.operationId === operationId,
  );
  await page.reload();
  expect((await replayed).ok()).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (userId) => localStorage.getItem(`moviefinder:commands:${userId}`),
        session.user.id,
      ),
    )
    .toBeNull();
});
test("replays a queued list creation before dependent additions and moves", async ({ page }) => {
  await register(page);
  const session = await (await page.request.get("/api/auth/get-session")).json(),
    listId = crypto.randomUUID(),
    itemId = crypto.randomUUID();
  await page.evaluate(
    ({ userId, listId, itemId }) =>
      localStorage.setItem(
        `moviefinder:commands:${userId}`,
        JSON.stringify([
          {
            type: "list.create",
            operationId: listId,
            title: "Recovered collection",
            description: "",
          },
          { type: "list.add", operationId: itemId, listId, titleId: "tmdb:movie:1" },
          { type: "list.move", operationId: crypto.randomUUID(), listId, itemId, beforeId: null },
        ]),
      ),
    { userId: session.user.id, listId, itemId },
  );
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        (userId) => localStorage.getItem(`moviefinder:commands:${userId}`),
        session.user.id,
      ),
    )
    .toBeNull();
  await page.goto(`/lists/${listId}`);
  await expect(
    page.getByRole("heading", { name: "Recovered collection", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".list-entry")).toHaveCount(1);
  await expect(page.locator(".list-entry")).toContainText("Test story 1");
});

test("starts data reads on hover, focus and press before navigating, and aborts abandoned intent", async ({
  page,
}) => {
  await register(page);
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "What are you in the mood for?" })).toBeVisible();
  for (const [index, type] of ["pointerover", "focusin", "pointerdown"].entries()) {
    const id = `tmdb:movie:${91000 + index}`;
    const request = page.waitForRequest(
      (r) => decodeURIComponent(new URL(r.url()).pathname) === `/api/title/${id}`,
    );
    await page.evaluate(
      ({ id, type }) => {
        const link = document.createElement("a");
        link.href = `/title/${encodeURIComponent(id)}`;
        link.textContent = "Intent target";
        // Offscreen links exercise intent without being selected by the viewport predictor.
        link.style.cssText = "position:absolute;top:-10000px;left:0";
        document.body.append(link);
        link.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }));
      },
      { id, type },
    );
    await request;
    await expect(page).toHaveURL(/\/search$/);
  }
  const id = "tmdb:movie:92000";
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/title/*92000*", async (route) => {
    await blocked;
    await route.continue().catch(() => {});
  });
  const failed = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().includes("92000"),
  });
  const requested = page.waitForRequest(
    (r) => r.url().includes("/api/title/") && r.url().includes("92000"),
  );
  await page.evaluate((id) => {
    const link = document.createElement("a");
    link.id = "abandoned-target";
    link.href = `/title/${encodeURIComponent(id)}`;
    link.style.cssText = "position:absolute;top:-10000px;left:0";
    document.body.append(link);
    link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  }, id);
  await requested;
  await page.locator("#abandoned-target").dispatchEvent("pointerout");
  await failed;
  release();
});

test("opens cached neighbour graphs and supports back/forward while detail responses and images are blocked", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, effectiveType: "4g" },
    }),
  );
  await register(page, "/title/tmdb%3Amovie%3A550");
  // Only seed the server's person cache. A fresh page must receive the neighbour graph with
  // the movie response, before any direct person HTTP request is allowed through.
  expect((await page.request.get("/api/title/tmdb%3Aperson%3A819?ready=1")).ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".person-card").first()).toBeVisible();
  let release!: () => void, releaseImage!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const imageBlocked = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  await page.route("**/transition-artwork.jpg", async (route) => {
    await imageBlocked;
    await route
      .fulfill({
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
      })
      .catch(() => {});
  });
  await page.route("**/api/title/*819*", async (route) => {
    await blocked;
    try {
      const response = await route.fetch();
      const result = await response.json();
      for (const entity of result.entities)
        if (entity.id === "tmdb:person:819") entity.poster = "/transition-artwork.jpg";
      await route.fulfill({ response, json: result });
    } catch {
      /* Back/forward navigation may abort an abandoned read. */
    }
  });
  const requested = page.waitForRequest(
    (r) => r.url().includes("/api/title/") && r.url().includes("819"),
  );
  await page.locator(".person-card").first().click();
  await requested;
  try {
    await expect(page.locator('.detail-page[data-title-id="tmdb:person:819"]')).toBeVisible({
      timeout: 500,
    });
    await expect(page.locator(".detail-intro h1")).toHaveText("Edward Norton");
    await expect(page.getByRole("heading", { name: "A career in stories." })).toBeVisible({
      timeout: 500,
    });
    await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
    await expect(page.locator(".detail-page")).toHaveAttribute("data-graph-scope", "viewport");
    await page.goBack();
    await expect(page.locator(".detail-intro h1")).toHaveText("Fight Club", { timeout: 500 });
    await page.goForward();
    await expect(page.locator(".detail-intro h1")).toHaveText("Edward Norton", { timeout: 500 });
    const imageRequested = page.waitForRequest((r) => r.url().endsWith("/transition-artwork.jpg"));
    release();
    await imageRequested;
    await expect(page.getByRole("heading", { name: "A career in stories." })).toBeVisible();
    await expect(page.locator(".detail-hero img")).toHaveJSProperty("complete", false);
    await expect(page.locator(".detail-page")).toHaveAttribute("data-graph-scope", "full");
    releaseImage();
    await expect(page.locator(".detail-hero img")).toHaveJSProperty("complete", true);
  } finally {
    release();
    releaseImage();
  }
});

test("all primary destinations open without waiting for API responses or additional screen scripts", async ({
  page,
}) => {
  await register(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/api\/(?:discover|title|titles|lists|profile|social-search|state)(?:[/?]|$)/,
    async (route) => {
      await blocked;
      await route.continue().catch(() => {});
    },
  );
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  try {
    for (const [label, path, heading] of [
      ["Search", "/search", "What are you in the mood for?"],
      ["Collections", "/lists", "A list for every kind of night."],
      ["Community", "/activity", "In good company."],
      ["Your profile", "/profile", ""],
      ["Discover", "/", "Find your next obsession."],
    ]) {
      await page.getByRole("link", { name: label!, exact: true }).first().click();
      await expect(page.locator("#main-content")).toHaveAttribute("data-route", path!, {
        timeout: 500,
      });
      if (heading)
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({
          timeout: 500,
        });
    }
    expect(scripts).toEqual([]);
  } finally {
    release();
  }
});

for (const saveData of [false, true]) {
  test(`prepares a bounded set of visible links and respects Save-Data (${saveData})`, async ({
    page,
  }) => {
    await page.addInitScript((saveData) => {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: { saveData, effectiveType: "4g" },
      });
    }, saveData);
    await register(page, "/search");
    await expect(
      page.getByRole("heading", { name: "What are you in the mood for?" }),
    ).toBeVisible();
    const requested = new Set<string>();
    page.on("request", (request) => {
      const path = decodeURIComponent(new URL(request.url()).pathname);
      if (/\/api\/title\/tmdb:movie:94\d{3}$/.test(path)) requested.add(path);
    });
    await page.evaluate(() => {
      for (let index = 0; index < 20; index++) {
        const link = document.createElement("a");
        link.href = `/title/${encodeURIComponent(`tmdb:movie:${94000 + index}`)}`;
        link.className = "title-card";
        link.textContent = "Visible candidate";
        link.style.cssText = `position:fixed;left:10px;top:${100 + index * 10}px;width:40px;height:10px`;
        document.body.append(link);
      }
    });
    if (!saveData) await expect.poll(() => requested.size).toBe(2);
    await page.waitForTimeout(900);
    expect(requested.size).toBe(saveData ? 0 : 2);
  });
}

test("preserves text typed while an earlier search destination is preparing", async ({ page }) => {
  await register(page, "/search");
  const input = page.getByRole("textbox", { name: "Search movies, series, people, and lists" });
  await expect(input).toBeVisible();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/discover?**", async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get("q") === "Fight") await blocked;
    await route.fulfill({ response });
  });
  const requested = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/discover" &&
      new URL(request.url()).searchParams.get("q") === "Fight",
  );
  await input.fill("Fight");
  await requested;
  await input.fill("Game");
  release();
  await expect(page).toHaveURL(/q=Game/);
  await expect(input).toHaveValue("Game");
});

test("applies discovery filters immediately while the next feed response is blocked", async ({
  page,
}) => {
  await register(page);
  const original = await page.locator(".swiper-slide-active .slide-title h2").textContent();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/discover?**", async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get("type") === "tv") await blocked;
    await route.fulfill({ response });
  });
  const requested = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/discover" &&
      new URL(request.url()).searchParams.get("type") === "tv",
  );
  await page.getByRole("button", { name: "TV shows", exact: true }).click();
  await requested;
  await expect(page).toHaveURL(/type=tv/);
  await expect(page.getByRole("button", { name: "TV shows", exact: true })).toHaveClass("active");
  await expect(page.getByRole("heading", { name: original!, exact: true })).toHaveCount(0);
  release();
  await expect(page.locator(".swiper-slide-active .slide-title h2")).toHaveText("Game of Thrones");
});

test("keeps search results distinct from an earlier filtered discovery query", async ({ page }) => {
  await register(page, "/?q=Fight&type=movie");
  await expect(page.locator(".discovery-slide").first()).toBeVisible();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search movies, series, people, and lists" })
    .fill("Fight");
  await expect(page.getByRole("heading", { name: "Game of Thrones", exact: true })).toBeVisible();
});

test("avoids detail requests while rapidly skimming links", async ({ page }) => {
  await register(page, "/search");
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (/\/api\/title\/tmdb:movie:95\d{3}$/.test(path)) reads.push(path);
  });
  await page.evaluate(async () => {
    for (let index = 0; index < 12; index++) {
      const link = document.createElement("a");
      link.href = `/title/${encodeURIComponent(`tmdb:movie:${95000 + index}`)}`;
      link.style.cssText = "position:absolute;top:-10000px;left:0";
      document.body.append(link);
      link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      link.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
      link.remove();
    }
  });
  await page.waitForTimeout(500);
  expect(reads).toEqual([]);
});

test("production browsing does not install or expose development diagnostics", async ({ page }) => {
  await register(page);
  expect(await page.evaluate(() => "__moviefinderTelemetry" in window)).toBe(false);
  const response = await page.evaluate(async () => {
    const response = await fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    return { status: response.status, serverTiming: response.headers.get("Server-Timing") };
  });
  expect(response).toEqual({ status: 404, serverTiming: null });
});
