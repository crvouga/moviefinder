import { expect, type Page } from "@playwright/test";

export async function completeGoogleSignIn(page: Page, identity: { name: string; email: string }) {
  const origin = new URL(page.url()).origin;
  await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
  await page.getByTestId("oauth-mock-create-account").click();
  await page.getByTestId("oauth-mock-signup-name").fill(identity.name);
  await page.getByTestId("oauth-mock-signup-email").fill(identity.email);
  await page.getByTestId("oauth-mock-signup-submit").click();
  await page.getByTestId("oauth-mock-allow").click();
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/auth"));
}

export async function setTestUsername(page: Page, name: string, username: string) {
  const response = await page.request.post(new URL("/api/command", page.url()).href, {
    headers: { Origin: new URL(page.url()).origin },
    data: { type: "profile", operationId: crypto.randomUUID(), name, username, bio: "", image: "" },
  });
  expect(response.status()).toBe(200);
}
