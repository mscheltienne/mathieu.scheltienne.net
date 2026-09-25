// GitHub highlights on the home page: rank ring, contribution stats and heatmap.
//
// Everything is fetched in the visitor's browser from public, token-free APIs:
// - github-contributions-api.jogruber.de: the profile contribution calendar,
//   which includes private contributions when the profile setting is enabled.
// - api.github.com: public counts used as inputs of the rank formula.
// Results are cached in localStorage to spare the (per-IP) API rate limits.
(() => {
  const root = document.querySelector(".gh-highlights");
  if (!root) return;

  const USERNAME = root.dataset.username;
  const MAINTAINED_REPOS = (root.dataset.maintainedRepos || "").split(",").filter(Boolean);
  const CACHE_TTL = 6 * 3600 * 1000; // 6 hours
  const CACHE_VERSION = 1;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY = 24 * 3600 * 1000;
  const fmt = (n) => n.toLocaleString("en-US");

  // ---- Caching -------------------------------------------------------------

  function cached(key, loader) {
    const storageKey = `gh-highlights:v${CACHE_VERSION}:${USERNAME}:${key}`;
    try {
      const entry = JSON.parse(localStorage.getItem(storageKey));
      if (entry && Date.now() - entry.time < CACHE_TTL) return Promise.resolve(entry.value);
    } catch {
      // Storage unavailable or corrupted entry: fall through to a fresh fetch.
    }
    return loader().then((value) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ time: Date.now(), value }));
      } catch {
        // Storage full or disabled: the data is simply not cached.
      }
      return value;
    });
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response.json();
    });
  }

  // ---- Contributions (includes private contributions) ----------------------

  const toISO = (date) => date.toISOString().slice(0, 10);
  const parseISO = (iso) => new Date(`${iso}T00:00:00Z`);

  function loadContributions() {
    return getJSON(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(USERNAME)}?y=all`).then(
      (data) => {
        const now = new Date();
        const today = toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
        const days = data.contributions.filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
        const end = parseISO(days[days.length - 1].date);
        // Same window as the GitHub profile: 52 weeks back, aligned on a Sunday.
        const start = new Date(end.getTime() - 364 * DAY);
        start.setUTCDate(start.getUTCDate() - start.getUTCDay());
        const startISO = toISO(start);
        const window = days.filter((d) => d.date >= startISO);
        const last365ISO = toISO(new Date(end.getTime() - 364 * DAY));
        const years = Object.keys(data.total)
          .filter((y) => data.total[y] > 0)
          .sort();
        return {
          total: Object.values(data.total).reduce((sum, n) => sum + n, 0),
          lastYear: window.reduce((sum, d) => sum + d.count, 0),
          activeDays: days.filter((d) => d.date >= last365ISO && d.count > 0).length,
          since: years[0],
          days: window.map((d) => [d.date, d.count, d.level]),
        };
      },
    );
  }

  // ---- Rank (github-readme-stats formula, public data) ----------------------

  function loadRankInputs() {
    const api = "https://api.github.com";
    const user = encodeURIComponent(USERNAME);
    const searchCount = (type, query) =>
      getJSON(`${api}/search/${type}?per_page=1&q=${encodeURIComponent(query)}`).then((j) => j.total_count);
    const stars = MAINTAINED_REPOS.length
      ? getJSON(
          `${api}/search/repositories?per_page=100&q=${encodeURIComponent(MAINTAINED_REPOS.map((r) => `repo:${r}`).join(" "))}`,
        ).then((j) => j.items.reduce((sum, repo) => sum + repo.stargazers_count, 0))
      : Promise.resolve(0);
    return Promise.all([
      searchCount("commits", `author:${USERNAME}`),
      searchCount("issues", `type:pr author:${USERNAME}`),
      searchCount("issues", `type:issue author:${USERNAME}`),
      searchCount("issues", `type:pr reviewed-by:${USERNAME}`),
      stars,
      getJSON(`${api}/users/${user}`).then((j) => j.followers),
    ]).then(([commits, prs, issues, reviews, stars, followers]) => ({
      commits,
      prs,
      issues,
      reviews,
      stars,
      followers,
    }));
  }

  // Port of calculateRank() from github-readme-stats / github-stats-extended,
  // with all-time commits.
  function calculateRank({ commits, prs, issues, reviews, stars, followers }) {
    const exponentialCdf = (x) => 1 - 2 ** -x;
    const logNormalCdf = (x) => x / (1 + x);
    const terms = [
      [2, exponentialCdf(commits / 1000)],
      [3, exponentialCdf(prs / 50)],
      [1, exponentialCdf(issues / 25)],
      [1, exponentialCdf(reviews / 2)],
      [4, logNormalCdf(stars / 50)],
      [1, logNormalCdf(followers / 10)],
    ];
    const totalWeight = terms.reduce((sum, [w]) => sum + w, 0);
    const percentile = 100 * (1 - terms.reduce((sum, [w, v]) => sum + w * v, 0) / totalWeight);
    const thresholds = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
    const levels = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
    return { level: levels[thresholds.findIndex((t) => percentile <= t)], percentile };
  }

  // ---- Rendering -----------------------------------------------------------

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs, text) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderStats(c) {
    const values = {
      total: fmt(c.total),
      lastYear: fmt(c.lastYear),
      activeDays: `${c.activeDays} / 365`,
      since: c.since,
    };
    for (const [key, value] of Object.entries(values)) {
      root.querySelector(`[data-stat="${key}"]`).textContent = value;
    }
  }

  function renderHeatmap(c) {
    const cell = 10,
      gap = 3,
      step = cell + gap,
      top = 18,
      left = 34;
    const offset = parseISO(c.days[0][0]).getUTCDay();
    const weeks = Math.ceil((c.days.length + offset) / 7);
    const width = left + weeks * step - gap,
      height = top + 7 * step - gap;
    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "img",
      "aria-label": `${fmt(c.lastYear)} contributions in the last year`,
    });
    let lastLabelCol = -Infinity,
      lastMonth = -1;
    c.days.forEach(([date, count, level], i) => {
      const col = Math.floor((i + offset) / 7),
        row = (i + offset) % 7;
      const d = parseISO(date);
      const rect = svgEl("rect", {
        x: left + col * step,
        y: top + row * step,
        width: cell,
        height: cell,
        rx: 2,
        class: `gh-l${level}`,
      });
      const label = `${count === 0 ? "No" : fmt(count)} contribution${count === 1 ? "" : "s"} on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
      rect.appendChild(svgEl("title", {}, label));
      svg.appendChild(rect);
      // Month label above the first week (column) of each month, skipping
      // labels that would overlap the previous one or overflow the right edge.
      if (row === 0 && d.getUTCMonth() !== lastMonth) {
        lastMonth = d.getUTCMonth();
        if (col - lastLabelCol >= 3 && col <= weeks - 2) {
          svg.appendChild(svgEl("text", { x: left + col * step, y: 12, class: "gh-heatmap-label" }, MONTHS[lastMonth]));
          lastLabelCol = col;
        }
      }
    });
    [
      [1, "Mon"],
      [3, "Wed"],
      [5, "Fri"],
    ].forEach(([row, name]) => {
      svg.appendChild(svgEl("text", { x: 0, y: top + row * step + cell, class: "gh-heatmap-label" }, name));
    });
    const graph = root.querySelector(".gh-heatmap-graph");
    graph.replaceChildren(svg);
    root.querySelector(".gh-heatmap figcaption").textContent = `${fmt(c.lastYear)} contributions in the last year`;
    return graph;
  }

  // Center the visible ink of the text on its (x, y) anchor. SVG centers the
  // advance width and the em box, which leaves glyphs like "A+" visibly off
  // center; canvas text metrics give the actual ink bounds for the used font.
  function centerGlyphs(textEl, value) {
    textEl.textContent = value;
    try {
      const style = getComputedStyle(textEl);
      const size = parseFloat(style.fontSize);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      const m = ctx.measureText(value);
      if (!m.actualBoundingBoxAscent) return; // metrics unsupported: keep CSS fallback
      const dx = m.width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
      const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      textEl.setAttribute("dx", dx.toFixed(2));
      textEl.setAttribute("dy", dy.toFixed(2));
    } catch {
      // Keep the static dy="0.35em" fallback from the markup.
    }
  }

  function renderRank(inputs) {
    const { level, percentile } = calculateRank(inputs);
    if (!level) return;
    const top = percentile < 10 ? percentile.toFixed(1) : Math.round(percentile);
    const rank = root.querySelector(".gh-rank");
    const description =
      `GitHub rank ${level} (top ${top}%), computed with the github-readme-stats formula ` +
      `from public commits, pull requests, issues, reviews and followers, ` +
      `counting the stars of the projects I maintain.`;
    rank.title = description;
    rank.querySelector("title").textContent = description;
    centerGlyphs(rank.querySelector(".gh-rank-level"), level);
    rank.querySelector(".gh-rank-progress").style.strokeDasharray = `${Math.max(0, 100 - percentile)} 100`;
    rank.querySelector(".gh-rank-caption").textContent = `Top ${top}%`;
    rank.hidden = false;
  }

  // ---- Main ----------------------------------------------------------------

  cached("contributions", loadContributions)
    .then((contributions) => {
      renderStats(contributions);
      root.hidden = false;
      const graph = renderHeatmap(contributions);
      // On narrow screens the heatmap scrolls: show the most recent weeks first.
      graph.scrollLeft = graph.scrollWidth;
      return cached("rank", loadRankInputs).then(renderRank);
    })
    .catch((error) => {
      // Keep the page clean if an API is unavailable or rate-limited; the
      // section stays hidden (or shows without the ring).
      console.warn("GitHub highlights:", error);
    });
})();
