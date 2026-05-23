import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/vite-env.d.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./test-results/coverage",
      thresholds: {
        // Vitest 4 V8 coverage uses AST remapping and excludes non-runtime lines,
        // so thresholds are lower than Vitest 2 reports for the same test suite.
        statements: 68,
        branches: 65,
        functions: 62,
        lines: 68,
      },
    },
  },
});
