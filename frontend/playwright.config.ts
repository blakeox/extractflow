import { defineConfig } from "@playwright/test";

const previewPort = process.env.PLAYWRIGHT_PORT ?? "42173";
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "line",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: previewUrl,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  outputDir: "./test-results/playwright",
  webServer: {
    command: `env -u FORCE_COLOR -u NO_COLOR -u NODE_DISABLE_COLORS VITE_API_BASE_URL=/api sh -c 'npm run build && npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort'`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "ignore",
  },
});
