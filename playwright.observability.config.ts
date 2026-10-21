import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/observability",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:5189", actionTimeout: 10000, navigationTimeout: 15000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "bun tests/e2e/server.ts",
    url: "http://127.0.0.1:5189/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
