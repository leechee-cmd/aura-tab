// Engine suggestions for the candidate panel.
//
// The source is fixed to Bing rather than following the user's chosen search engine:
// Chrome exposes no way to read which engine is the default, so following it would mean
// guessing — and sending the input to the wrong engine. One source also means one parser
// to keep alive. Enter still searches with the chosen engine, so a suggestion can read
// one way and land on another engine's results; that mismatch is the price of a fixed
// source and was accepted.
//
// Two hosts, same endpoint: api.bing.com is not reliably reachable from mainland China,
// cn.bing.com is. The first one that answers is remembered for the rest of the session, so
// only the first query of a bad network pays for the attempt.

const ENDPOINTS = [
    'https://api.bing.com/osjson.aspx?query=',
    'https://cn.bing.com/osjson.aspx?query='
];

export const SUGGEST_TIMEOUT_MS = 1500;
export const SUGGEST_MAX_ITEMS = 5;
export const SUGGEST_MAX_QUERY = 64;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 40;

// query (lowercased) -> { items, at }. Insertion-ordered, so the oldest key is first.
const cache = new Map();

// Index into ENDPOINTS of the host that answered last. Moves only when a host fails.
let preferredHost = 0;

// Both hosts dead (offline, captive portal): stop asking for a while instead of paying the
// timeouts again on every keystroke.
const FAILURE_COOLDOWN_MS = 30 * 1000;
let cooldownUntil = 0;

export function clearSuggestionCache() {
    cache.clear();
    preferredHost = 0;
    cooldownUntil = 0;
}

export function getPreferredHost() {
    return ENDPOINTS[preferredHost];
}

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.items;
}

function cacheSet(key, items) {
    cache.delete(key);
    cache.set(key, { items, at: Date.now() });
    while (cache.size > CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
}

export function normalizeQuery(raw) {
    return Array.from(String(raw ?? ''))
        .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
        .join('')
        .trim()
        .slice(0, SUGGEST_MAX_QUERY);
}

/**
 * Bing answers with ["<query>",["s1","s2",…]]. Returns null when the body is not that
 * shape at all — an HTML error page, a captive portal, a truncated response — so the
 * caller knows to try the other host. A well-formed answer with no suggestions is an
 * empty array, and is not a failure.
 */
function parseList(text, query) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        return null;
    }

    if (!Array.isArray(payload) || !Array.isArray(payload[1])) return null;

    const needle = normalizeQuery(query).toLowerCase();
    const seen = new Set();
    const items = [];

    for (const raw of payload[1]) {
        if (typeof raw !== 'string') continue;
        const suggestion = raw.replace(/\s+/g, ' ').trim();
        if (!suggestion) continue;
        const key = suggestion.toLowerCase();
        if (key === needle) continue; // the typed text itself; Enter already searches it
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(suggestion);
        if (items.length >= SUGGEST_MAX_ITEMS) break;
    }

    return items;
}

export function parseSuggestionResponse(text, query) {
    return parseList(text, query) ?? [];
}

/**
 * One host, one try. Returns { items } on a usable answer (which may be empty),
 * { failed: true } when this host is no good, or { aborted: true } when the caller
 * cancelled — the loop must not continue to the next host in that case.
 */
async function attempt(endpoint, query, signal, timeoutMs) {
    if (signal?.aborted) return { aborted: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, { once: true });

    try {
        const response = await fetch(endpoint + encodeURIComponent(query), {
            signal: controller.signal,
            credentials: 'omit',
            cache: 'default'
        });
        if (!response.ok) return { failed: true };
        const items = parseList(await response.text(), query);
        return items ? { items } : { failed: true };
    } catch {
        if (signal?.aborted) return { aborted: true };
        // Timed out or refused: this host is no good right now, try the next one.
        return { failed: true };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', relay);
    }
}

/**
 * Suggestions for a query, or [] when there is nothing to show. Never throws and never
 * surfaces a failure: offline, a timeout, a blocked host and a changed endpoint all look
 * the same from the panel.
 */
export async function fetchSuggestions(query, { signal, timeoutMs = SUGGEST_TIMEOUT_MS } = {}) {
    const q = normalizeQuery(query);
    if (!q) return [];

    const key = q.toLowerCase();
    const cached = cacheGet(key);
    if (cached) return cached;
    if (Date.now() < cooldownUntil) return [];

    for (let step = 0; step < ENDPOINTS.length; step += 1) {
        const index = (preferredHost + step) % ENDPOINTS.length;
        const result = await attempt(ENDPOINTS[index], q, signal, timeoutMs);

        if (result.aborted) return [];
        if (result.items) {
            preferredHost = index;
            cooldownUntil = 0;
            cacheSet(key, result.items);
            return result.items;
        }
    }

    cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
    return [];
}
