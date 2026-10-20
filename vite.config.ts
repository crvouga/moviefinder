import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const apiTarget = `http://127.0.0.1:${process.env.PORT ?? 8080}`;
export default defineConfig({
  fmt: { ignorePatterns: ["SPEC.md", ".super.engineering/config.json"] },
  plugins: [react(), tailwind()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.MOVIEFINDER_WEB_PORT) || undefined,
    strictPort: Boolean(process.env.MOVIEFINDER_WEB_PORT),
    watch: { ignored: ["**/.local/**"] },
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**"] },
    proxy: { "/api": apiTarget, "/health": apiTarget },
  },
  build: { outDir: "dist", sourcemap: false },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "node_modules/**"],
    rules: { "no-console": "off" },
  },
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "local-database",
          include: ["tests/local-database/**/*.test.ts"],
          testTimeout: 30000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
