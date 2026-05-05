import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "line",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  outputDir: "./test-results/playwright",
  webServer: {
    command:
      "env -u FORCE_COLOR -u NO_COLOR -u NODE_DISABLE_COLORS VITE_API_BASE_URL=/api sh -c 'npm run build && npm run preview'",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "ignore",
  },
});
