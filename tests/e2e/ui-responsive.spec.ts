import { expect, test } from "@playwright/test";
import { completeGoogleSignIn } from "../fixtures/google-browser";

test("small phones and tablets keep routes, navigation and filter forms within the viewport", async ({
  page,
}, info) => {
  await page.goto("/auth");
  await completeGoogleSignIn(page, {
    name: "Layout Test",
    email: `layout_${crypto.randomUUID().slice(0, 8)}@example.test`,
  });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1024 });
    for (const [path, heading] of [
      ["/", "Discover"],
      ["/search", "Search"],
      ["/lists", "Lists"],
      ["/activity", "Activity"],
      ["/profile", "Layout Test"],
      ["/title/tmdb%3Amovie%3A550", "Fight Club"],
      ["/title/tmdb%3Aperson%3A819", "Edward Norton"],
    ]) {
      await page.goto(path!);
      await expect(page.getByRole("heading", { name: heading!, exact: true })).toBeVisible();
      await expect(page.locator("[data-screen-preview]")).toHaveCount(0);
      expect(
        await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth),
        `${width}px ${path}`,
      ).toBe(true);
      if (path === "/") {
        const artwork = page.locator(".swiper-slide-active .slide-artwork");
        await expect(artwork).toBeVisible();
        await expect(artwork.locator("[data-artwork-sticker]")).toHaveCount(2);
        const bounds = await artwork.evaluate((element) => {
          const rectangle = (node: Element) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          };
          return {
            artwork: rectangle(element),
            stickers: [...element.querySelectorAll("[data-artwork-sticker]")].map(rectangle),
          };
        });
        expect(bounds.artwork.width).toBeGreaterThan(0);
        expect(bounds.artwork.height).toBeGreaterThan(0);
        for (const sticker of bounds.stickers) {
          expect(sticker.width).toBeGreaterThan(0);
          expect(sticker.height).toBeGreaterThan(0);
          expect(sticker.x).toBeGreaterThanOrEqual(bounds.artwork.x);
          expect(sticker.y).toBeGreaterThanOrEqual(bounds.artwork.y);
          expect(sticker.x + sticker.width).toBeLessThanOrEqual(
            bounds.artwork.x + bounds.artwork.width,
          );
          expect(sticker.y + sticker.height).toBeLessThanOrEqual(
            bounds.artwork.y + bounds.artwork.height,
          );
        }
      }
      if (path!.startsWith("/title/")) {
        await expect(page.locator(".detail-page")).toHaveAttribute("data-content-ready", "true");
        await page.screenshot({
          path: `test-results/${info.project.name}-${width}px-${heading!.replaceAll(" ", "-")}.png`,
          fullPage: true,
        });
      }
    }
    await page.goto("/");
    await page.getByRole("button", { name: "Customize feed filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Feed filters" });
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.screenshot({
      path: `test-results/${info.project.name}-${width}px-discover.png`,
      fullPage: true,
    });
  }
});
