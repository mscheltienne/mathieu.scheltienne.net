// GitHub highlights on the home page: rank ring, stats and contribution
// heatmap, rendered in the browser from the github-stats Worker's /data.json
// (see worker/). Bundled by Hugo (js.Build) from layouts/_partials/home/extensions.html.
// render.js is worker/src/render.js, mounted into the assets by src/hugo.toml.
import { heatmapSVG, ringSVG, statItems, topPercent } from "./render.js";

const root = document.querySelector(".gh-highlights");

// Center the visible ink of the rank letters on their anchor. The shared SVG
// only approximates it (it cannot measure text); canvas text metrics give the
// actual ink bounds for the font used by this browser.
function centerGlyphs(textEl) {
  try {
    const style = getComputedStyle(textEl);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize)}px ${style.fontFamily}`;
    const m = ctx.measureText(textEl.textContent);
    if (!m.actualBoundingBoxAscent) return; // metrics unsupported: keep the approximation
    const dx = m.width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    textEl.setAttribute("dx", dx.toFixed(2));
    textEl.setAttribute("dy", dy.toFixed(2));
  } catch {
    // Keep the approximation from the shared SVG.
  }
}

function renderStats(data, ids) {
  const list = root.querySelector(".gh-stats");
  list.replaceChildren(
    ...statItems(data, ids).map(({ label, value }) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );
}

function renderRank(rank) {
  const container = root.querySelector(".gh-rank");
  container.querySelector(".gh-rank-graph").innerHTML = ringSVG(rank);
  container.querySelector(".gh-rank-caption").textContent = `Top ${topPercent(rank.percentile)}%`;
  container.hidden = false;
  centerGlyphs(container.querySelector(".gh-rank-level"));
}

function renderHeatmap(data) {
  const graph = root.querySelector(".gh-heatmap-graph");
  graph.innerHTML = heatmapSVG(data.contributions.days);
  root.querySelector(".gh-heatmap figcaption").textContent =
    `${data.contributions.lastYear.toLocaleString("en-US")} contributions in the last year`;
}

if (root) {
  fetch(root.dataset.endpoint)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      renderStats(data, root.dataset.stats.split(","));
      root.hidden = false; // before measuring: layout is needed for the next steps
      if (data.rank?.level) renderRank(data.rank);
      renderHeatmap(data);
      // On narrow screens the heatmap scrolls: show the most recent weeks first,
      // once the final layout is known.
      requestAnimationFrame(() => {
        const graph = root.querySelector(".gh-heatmap-graph");
        graph.scrollLeft = graph.scrollWidth;
      });
    })
    .catch((error) => {
      // Keep the page clean if the Worker is unavailable: the section stays hidden.
      console.warn("GitHub highlights:", error);
    });
}
