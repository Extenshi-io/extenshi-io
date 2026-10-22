#!/usr/bin/env node
/**
 * summary.mjs — print results/*.json as one markdown table, scenario × Chrome
 * version, so the "verified" block quotes the run instead of a retyping of it.
 *
 *   node verify/summary.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

const runs = fs
  .readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8")))
  .sort((a, b) => a.chromeVersion.localeCompare(b.chromeVersion, undefined, { numeric: true }));

// The bringUp entries are the recommended pattern, not a browser event; they
// get their own check below instead of a place in the cells.
const cell = (scenario) =>
  scenario.entries
    .filter((e) => e.event !== "worker-start" && e.event !== "bringUp")
    .map((e) => `\`${e.event}${e.reason ? ` (${e.reason})` : ""}\``)
    .join(" + ") || "—";

const names = runs[0].scenarios.map((s) => s.name);
console.log(`| Scenario | ${runs.map((r) => `Chrome ${r.chromeVersion}`).join(" | ")} |`);
console.log(`|---|${runs.map(() => "---").join("|")}|`);
for (const name of names) {
  const cells = runs.map((r) => cell(r.scenarios.find((s) => s.name === name)));
  console.log(`| ${name} | ${cells.join(" | ")} |`);
}

const pattern = runs.flatMap((r) =>
  r.scenarios.map((s) => ({
    where: `${r.chromeVersion} ${s.name}`,
    calls: s.entries.filter((e) => e.event === "bringUp").length
  }))
);
const off = pattern.filter((p) => p.calls !== 1);
console.log(
  `\nbringUp() ran exactly once in ${pattern.length - off.length}/${pattern.length} scenario runs` +
    (off.length ? `; off: ${off.map((p) => `${p.where} ×${p.calls}`).join(", ")}` : "")
);
