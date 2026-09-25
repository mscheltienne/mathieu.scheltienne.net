// Local development helper: render the card exactly as the Worker's /card.svg
// does, from a payload written by fetch-local.mjs, plus an HTML page showing
// both themes on the GitHub README backgrounds.
//
//   node scripts/render-card.mjs <data.json> <output-dir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../config.json" with { type: "json" };
import { cardSVG } from "../src/render.js";

const BACKGROUNDS = { light: "#ffffff", dark: "#0d1117" };

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("usage: node scripts/render-card.mjs <data.json> <output-dir>");
  process.exit(2);
}
const data = JSON.parse(await readFile(input, "utf8"));
await mkdir(outDir, { recursive: true });

let panels = "";
for (const theme of ["light", "dark"]) {
  const file = `card-${theme}.svg`;
  await writeFile(join(outDir, file), cardSVG(data, data.rank, { theme, stats: config.cardStats }));
  panels += `<div style="background:${BACKGROUNDS[theme]}"><img src="${file}" alt="GitHub activity (${theme})"></div>`;
}
await writeFile(
  join(outDir, "card.html"),
  `<!doctype html><meta charset="utf-8"><title>GitHub card preview</title>
<style>body{margin:0;padding:24px;background:#e8e8e8;display:flex;flex-wrap:wrap;gap:16px}div{padding:24px;border-radius:6px}</style>
${panels}`,
);
console.log(
  `rank ${data.rank.level} (top ${data.rank.percentile}%), wrote card-light.svg, card-dark.svg and card.html to ${outDir}`,
);
