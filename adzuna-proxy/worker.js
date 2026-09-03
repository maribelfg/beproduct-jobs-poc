const ALLOWED_WHAT = new Set(['product manager', 'product designer']);
const CACHE_TTL_SECONDS = 6 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const url = new URL(request.url);
    const what = (url.searchParams.get('what') || '').toLowerCase();
    const page = url.searchParams.get('page') || '1';

    if (!ALLOWED_WHAT.has(what)) {
      return new Response(JSON.stringify({ error: 'unsupported what' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (!/^[1-9][0-9]?$/.test(page)) {
      return new Response(JSON.stringify({ error: 'invalid page' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Cache per (what, page) so repeat page loads across all visitors don't
    // each burn Adzuna quota — free plans are capped at 250 calls/month.
    const cacheKey = new Request(new URL(`/cache/${what}/${page}`, url.origin), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const cachedBody = await cached.text();
      return new Response(cachedBody, {
        status: cached.status,
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    const upstream = new URL(`https://api.adzuna.com/v1/api/jobs/es/search/${page}`);
    upstream.searchParams.set('app_id', env.ADZUNA_APP_ID);
    upstream.searchParams.set('app_key', env.ADZUNA_APP_KEY);
    upstream.searchParams.set('what', what);
    upstream.searchParams.set('results_per_page', '50');
    upstream.searchParams.set('content-type', 'application/json');

    const res = await fetch(upstream.toString());
    const body = await res.text();

    if (res.ok) {
      const toCache = new Response(body, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` },
      });
      ctx.waitUntil(cache.put(cacheKey, toCache));
    }

    return new Response(body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  },
};
