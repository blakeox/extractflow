import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import vitest from "@vitest/eslint-plugin";
import jestDom from "eslint-plugin-jest-dom";
import jsxA11y from "eslint-plugin-jsx-a11y";
import playwright from "eslint-plugin-playwright";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import testingLibrary from "eslint-plugin-testing-library";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "playwright-report", "test-results"],
  },
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    ...testingLibrary.configs["flat/react"],
    files: ["src/**/*.test.{ts,tsx}"],
  },
  {
    ...jestDom.configs["flat/recommended"],
    files: ["src/**/*.test.{ts,tsx}"],
  },
  {
    ...vitest.configs.recommended,
    files: ["src/**/*.test.{ts,tsx}"],
  },
  {
    ...playwright.configs["flat/recommended"],
    files: ["e2e/**/*.ts"],
  },
  eslintConfigPrettier,
);
