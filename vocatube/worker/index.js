import {
  fetchChannelShorts,
  fetchChannelVideos,
  fetchPlaylist,
  fetchTranscript
} from "./youtube.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400"
};

const routes = {
  "/api/transcript": {
    parameter: "videoId",
    valid: value => /^[\w-]{11}$/.test(value || ""),
    invalid: "Invalid video ID",
    maxAge: 86400,
    load: (value, url) => fetchTranscript(value, url.searchParams.get("lang") || "de")
  },
  "/api/playlist": {
    parameter: "list",
    valid: value => /^[\w-]{10,80}$/.test(value || ""),
    invalid: "Invalid playlist ID",
    maxAge: 900,
    load: value => fetchPlaylist(value)
  },
  "/api/channel": {
    parameter: "handle",
    valid: value => /^[\w.-]{3,40}$/.test(value || ""),
    invalid: "Invalid channel handle",
    maxAge: 900,
    load: value => fetchChannelVideos(value)
  },
  "/api/shorts": {
    parameter: "handle",
    valid: value => /^[\w.-]{3,40}$/.test(value || ""),
    invalid: "Invalid channel handle",
    maxAge: 900,
    load: value => fetchChannelShorts(value)
  }
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store", ...headers }
  });
}

export default {
  async fetch(request, env, context) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });

    const url = new URL(request.url);
    const route = routes[url.pathname];
    if (!route) return json({ error: "Not found" }, 404);
    const value = url.searchParams.get(route.parameter);
    if (!route.valid(value)) return json({ error: route.invalid }, 400);

    const cache = globalThis.caches?.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) return cached;

    try {
      const response = json(await route.load(value, url), 200, {
        "Cache-Control": `public, max-age=${route.maxAge}`
      });
      if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      console.error(`${url.pathname} failed:`, error);
      return json({ error: error.message || "YouTube request failed" }, 502);
    }
  }
};
