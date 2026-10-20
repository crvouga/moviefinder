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
