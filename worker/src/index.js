// Cloudflare Worker serving GitHub activity highlights.
//
//   GET /data.json               public aggregates (used by the website)
//   GET /card.svg?theme=light    standalone SVG card (used by the GitHub README)
//   GET /card.svg?theme=dark
//
// The username and settings are fixed in config.json: the Worker cannot be
// used to query other accounts. Data is fetched with the GITHUB_TOKEN secret,
// kept in KV and refreshed in the background once older than REFRESH_AFTER,
// so requests are always served from storage and the last good result keeps
// being served if GitHub is unavailable.

import config from "../config.json";
import { fetchActivity, SCHEMA_VERSION } from "./github.js";
import { publicData } from "./public.js";
import { cardSVG } from "./render.js";

const REFRESH_AFTER = 6 * 3600 * 1000; // 6 hours
const LOCK_TTL = 120; // seconds, minimum allowed by KV is 60
const KV_KEY = `activity:v${SCHEMA_VERSION}`;
const KV_LOCK = `${KV_KEY}:refreshing`;
const BROWSER_CACHE = "public, max-age=3600";

async function refresh(env) {
  const activity = await fetchActivity({
    token: env.GITHUB_TOKEN,
    username: config.username,
    maintainedRepos: config.maintainedRepos,
  });
  const data = publicData(activity);
  await env.CACHE.put(KV_KEY, JSON.stringify(data));
  return data;
}

async function refreshInBackground(env) {
  // Best-effort lock so concurrent requests do not all refresh at once.
  if (await env.CACHE.get(KV_LOCK)) return;
  await env.CACHE.put(KV_LOCK, "1", { expirationTtl: LOCK_TTL });
  try {
    await refresh(env);
    await env.CACHE.delete(KV_LOCK);
  } catch (error) {
    // Keep the lock until it expires, so a GitHub outage is retried at most
    // every LOCK_TTL seconds instead of on every request.
    console.error("refresh failed, keeping the last good data:", error.message);
  }
}

async function getData(env, ctx) {
  const stored = await env.CACHE.get(KV_KEY, "json");
  if (!stored) return refresh(env); // first run: nothing to serve yet
  // An unreadable date (NaN) fails the comparison and counts as stale.
  if (!(Date.now() - Date.parse(stored.generatedAt) <= REFRESH_AFTER)) {
    ctx.waitUntil(refreshInBackground(env));
  }
  return stored;
}

function respond(request, body, contentType, { etag: tag, headers: extraHeaders = {} }) {
  const etag = `"${tag}"`;
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": BROWSER_CACHE,
    ETag: etag,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/data.json" && url.pathname !== "/card.svg") {
      return new Response("Not found", { status: 404 });
    }

    let data;
    try {
      data = await getData(env, ctx);
    } catch (error) {
      console.error("no data available:", error.message);
      return new Response("GitHub data temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
    }

    if (url.pathname === "/data.json") {
      return respond(request, JSON.stringify(data), "application/json; charset=utf-8", { etag: data.generatedAt });
    }
    const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
    const svg = cardSVG(data, data.rank, { theme, stats: config.cardStats });
    return respond(request, svg, "image/svg+xml; charset=utf-8", {
      etag: `${data.generatedAt}-${theme}`,
      headers: { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
    });
  },
};
