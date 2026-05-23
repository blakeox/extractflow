import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const assetsDir = path.join(rootDir, "frontend", "dist", "assets");
const bundleSummaryPath = path.join(
  rootDir,
  "frontend",
  "test-results",
  "bundle-size.json",
);

const defaultBudgets = {
  js: 320 * 1024,
  css: 40 * 1024,
};

const budgets = {
  js: Number(process.env.FRONTEND_BUNDLE_MAX_JS_BYTES ?? defaultBudgets.js),
  css: Number(process.env.FRONTEND_BUNDLE_MAX_CSS_BYTES ?? defaultBudgets.css),
};

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

const files = await readdir(assetsDir);
const sizeByType = { js: 0, css: 0 };

for (const file of files) {
  const extension = path.extname(file);
  if (extension !== ".js" && extension !== ".css") {
    continue;
  }

  const filePath = path.join(assetsDir, file);
  const fileStat = await stat(filePath);
  sizeByType[extension.slice(1)] += fileStat.size;
}

const failures = Object.entries(budgets).flatMap(([assetType, budget]) => {
  const actual = sizeByType[assetType];
  if (actual <= budget) {
    return [];
  }

  return [
    `${assetType.toUpperCase()} bundle ${formatBytes(actual)} exceeds budget ${formatBytes(budget)}`,
  ];
});

const summary = {
  budgets,
  actual: sizeByType,
  failures,
};

await mkdir(path.dirname(bundleSummaryPath), { recursive: true });
await writeFile(
  `${bundleSummaryPath}`,
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log("Frontend bundle budgets");
console.log(
  `- JS total:  ${formatBytes(sizeByType.js)} / ${formatBytes(budgets.js)}`,
);
console.log(
  `- CSS total: ${formatBytes(sizeByType.css)} / ${formatBytes(budgets.css)}`,
);

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`ERROR: ${failure}`);
  }
  process.exit(1);
}
