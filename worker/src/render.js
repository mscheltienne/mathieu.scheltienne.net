// Rendering of the GitHub highlights as SVG strings. Pure functions with no
// DOM or runtime dependency, shared by the Cloudflare Worker (standalone SVG
// card for the GitHub profile README) and the website, where Hugo mounts this
// file as assets/js/github-highlights/render.js (see src/hugo.toml).

export const PALETTES = {
  light: {
    fg: "#212121",
    muted: "#616161",
    accent: "#1565c0",
    track: "#e0e0e0",
    levels: ["#e0e0e0", "#bbdefb", "#64b5f6", "#1e88e5", "#0d47a1"],
  },
  dark: {
    fg: "#dadada",
    muted: "#9e9e9e",
    accent: "#42a5f5",
    track: "#424242",
    levels: ["#383838", "#0d3a66", "#1565c0", "#42a5f5", "#90caf9"],
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatNumber = (n) => Number(n).toLocaleString("en-US");

export function escapeXML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

const percent = (rate) => `${(100 * rate).toFixed(1)}%`;

// Displayable stats, keyed by id. All include private activity.
export const STATS = {
  commits: { label: "Commits", value: (d) => formatNumber(d.activity.commits) },
  pullRequestsMerged: {
    label: "Pull requests",
    value: (d) => `${formatNumber(d.activity.pullRequests)} · ${percent(d.activity.mergedRate)} merged`,
  },
  reviews: { label: "Reviews", value: (d) => formatNumber(d.activity.reviews) },
  repositories: { label: "Repositories", value: (d) => formatNumber(d.activity.repositories) },
  organizations: { label: "Organizations", value: (d) => formatNumber(d.activity.organizations) },
};

export function statItems(data, ids) {
  return ids.filter((id) => STATS[id]).map((id) => ({ id, label: STATS[id].label, value: STATS[id].value(data) }));
}

export function rankDescription({ level, percentile }) {
  return (
    `GitHub rank ${level} (top ${topPercent(percentile)}%), computed with the github-readme-stats ` +
    `formula from commits, pull requests, issues and reviews (including private work) and ` +
    `followers, counting the stars of the projects I maintain.`
  );
}

export const topPercent = (percentile) => (percentile < 10 ? percentile.toFixed(1) : String(Math.round(percentile)));

// ---- Ring --------------------------------------------------------------------

// Ring in a 120x120 box. Glyph centering: dy centers capital letters on the
// cap height; the horizontal correction compensates the side bearing of a
// "+"/"-" suffix. The browser refines both with measured ink bounds.
export function ringSVG(rank, { size = 120, x = 0, y = 0, title = true } = {}) {
  const progress = Math.max(0, Math.min(100, 100 - rank.percentile));
  const dx = /[+-]$/.test(rank.level) ? "0.056em" : "0";
  return (
    `<svg class="gh-rank-ring" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${escapeXML(`GitHub rank ${rank.level}`)}">` +
    (title ? `<title>${escapeXML(rankDescription(rank))}</title>` : "") +
    `<circle class="gh-rank-track" cx="60" cy="60" r="50" pathLength="100" fill="none" stroke-width="8"/>` +
    `<circle class="gh-rank-progress" cx="60" cy="60" r="50" pathLength="100" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${progress.toFixed(2)} 100" transform="rotate(-90 60 60)"/>` +
    `<text class="gh-rank-level" x="60" y="60" dx="${dx}" dy="0.35em" text-anchor="middle" font-size="40" font-weight="700">${escapeXML(rank.level)}</text>` +
    `</svg>`
  );
}

// ---- Heatmap -------------------------------------------------------------------

export const HEATMAP = { cell: 10, gap: 3, top: 18, left: 34, font: 13 };

export function heatmapSize(days) {
  const { cell, gap, top, left } = HEATMAP;
  const step = cell + gap;
  const offset = new Date(`${days[0][0]}T00:00:00Z`).getUTCDay();
  const weeks = Math.ceil((days.length + offset) / 7);
  return { weeks, offset, width: left + weeks * step - gap, height: top + 7 * step - gap };
}

// days: [[ISO date, count, level 0-4], ...] in chronological order.
export function heatmapSVG(days, { x = 0, y = 0, width, tooltips = true } = {}) {
  const { cell, gap, top, left, font } = HEATMAP;
  const step = cell + gap;
  const size = heatmapSize(days);
  const total = days.reduce((sum, [, count]) => sum + count, 0);
  const parts = [];
  let lastLabelCol = -Infinity;
  let lastMonth = -1;
  days.forEach(([date, count, level], i) => {
    const col = Math.floor((i + size.offset) / 7);
    const row = (i + size.offset) % 7;
    const d = new Date(`${date}T00:00:00Z`);
    const tip = tooltips
      ? `<title>${count === 0 ? "No" : formatNumber(count)} contribution${count === 1 ? "" : "s"} on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}</title>`
      : "";
    parts.push(
      `<rect x="${left + col * step}" y="${top + row * step}" width="${cell}" height="${cell}" rx="2" class="gh-l${level}">${tip}</rect>`,
    );
    // Month label above the first week of each month, skipping labels that
    // would overlap the previous one or overflow the right edge.
    if (row === 0 && d.getUTCMonth() !== lastMonth) {
      lastMonth = d.getUTCMonth();
      if (col - lastLabelCol >= 3 && col <= size.weeks - 2) {
        parts.push(`<text x="${left + col * step}" y="12" class="gh-heatmap-label">${MONTHS[lastMonth]}</text>`);
        lastLabelCol = col;
      }
    }
  });
  [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ].forEach(([row, name]) => {
    parts.push(`<text x="0" y="${top + row * step + cell}" class="gh-heatmap-label">${name}</text>`);
  });
  const w = width || size.width;
  const h = (w / size.width) * size.height;
  return (
    `<svg class="gh-heatmap-svg" x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="${formatNumber(total)} contributions in the last year" font-size="${font}">` +
    parts.join("") +
    `</svg>`
  );
}

// ---- Standalone card (GitHub README) -------------------------------------------

function cardStyle(theme) {
  const p = PALETTES[theme] || PALETTES.light;
  return (
    `<style>` +
    `svg{font-family:${FONT}}` +
    `.gh-fg{fill:${p.fg}}.gh-muted,.gh-heatmap-label{fill:${p.muted}}` +
    `.gh-rank-track{stroke:${p.track}}.gh-rank-progress{stroke:${p.accent}}.gh-rank-level{fill:${p.fg}}` +
    p.levels.map((color, i) => `.gh-l${i}{fill:${color}}`).join("") +
    `.gh-value{font-weight:700;font-variant-numeric:tabular-nums}` +
    `@media (prefers-reduced-motion:no-preference){.gh-rank-progress{animation:gh-ring 1s ease-out}}` +
    `@keyframes gh-ring{from{stroke-dasharray:0 100}}` +
    `</style>`
  );
}

function statsSVG(items, { x, y, width, lineHeight = 26, fontSize = 15 }) {
  return items
    .map(({ label, value }, i) => {
      const baseline = y + i * lineHeight + fontSize;
      return (
        `<text x="${x}" y="${baseline}" font-size="${fontSize}" class="gh-muted">${escapeXML(label)}</text>` +
        `<text x="${x + width}" y="${baseline}" font-size="${fontSize}" text-anchor="end" class="gh-fg gh-value">${escapeXML(value)}</text>`
      );
    })
    .join("");
}

/**
 * Full card as a standalone SVG document: ring and stats side by side, with
 * the heatmap below, sized to fit a GitHub README without scaling.
 * @param {object} data Public activity data (see worker/src/index.js).
 * @param {{level: string, percentile: number}} rank
 * @param {object} options
 * @param {"light"|"dark"} options.theme
 * @param {string[]} options.stats Ids from STATS, in display order.
 */
export function cardSVG(data, rank, { theme = "light", stats }) {
  const items = statItems(data, stats);
  const pad = 12;
  const gap = 36;
  const ring = 110;
  const caption = 22;
  const statsWidth = 260;
  const lineHeight = 26;
  const statsHeight = items.length * lineHeight - (lineHeight - 18);
  const heat = heatmapSize(data.contributions.days);
  const heatCaption = `${formatNumber(data.contributions.lastYear)} contributions in the last year`;
  const blockHeight = Math.max(ring + caption, statsHeight);

  const width = pad * 2 + heat.width;
  const ringX = pad + (heat.width - (ring + gap + statsWidth)) / 2;
  const ringY = pad + (blockHeight - ring - caption) / 2;
  const statsX = ringX + ring + gap;
  const statsY = pad + (blockHeight - statsHeight) / 2;
  const heatX = pad;
  const heatY = pad + blockHeight + 28;
  const heatW = heat.width;
  const height = heatY + heat.height + 24 + pad;
  const heatCaptionY = heatY + heat.height + 20;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXML(`GitHub activity: ${items.map((s) => `${s.label} ${s.value}`).join(", ")}`)}">` +
    cardStyle(theme) +
    ringSVG(rank, { x: ringX, y: ringY, size: ring }) +
    `<text x="${ringX + ring / 2}" y="${ringY + ring + 18}" font-size="13" text-anchor="middle" class="gh-muted">Top ${topPercent(rank.percentile)}%</text>` +
    statsSVG(items, { x: statsX, y: statsY, width: statsWidth, lineHeight }) +
    heatmapSVG(data.contributions.days, { x: heatX, y: heatY, width: heatW, tooltips: false }) +
    `<text x="${heatX + heatW}" y="${heatCaptionY}" font-size="13" text-anchor="end" class="gh-muted">${escapeXML(heatCaption)}</text>` +
    `</svg>`
  );
}
