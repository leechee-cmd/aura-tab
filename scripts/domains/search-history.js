import { getSyncSettings } from '../platform/settings-contract.js';

const STORAGE_KEY = 'searchHistory';

export const SEARCH_HISTORY_LIMIT = 50;

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const q = typeof raw.q === 'string' ? raw.q.trim() : '';
    if (!q) return null;
    return { q, t: Number.isFinite(raw.t) ? raw.t : 0 };
}

function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const entries = [];
    for (const item of raw) {
        const entry = normalizeEntry(item);
        if (!entry) continue;
        const key = entry.q.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
        if (entries.length >= SEARCH_HISTORY_LIMIT) break;
    }
    return entries;
}

// Read-modify-write on one storage key: serialize writes so two quick searches
// cannot clobber each other, and let reads wait for a pending write to land.
let writeQueue = Promise.resolve();

function enqueue(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(
        () => {},
        () => {}
    );
    return run;
}

async function readRaw() {
    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    return normalizeEntries(stored[STORAGE_KEY]);
}

export async function readSearchHistory() {
    await writeQueue;
    try {
        return await readRaw();
    } catch (error) {
        console.warn('[SearchHistory] Failed to read history:', error);
        return [];
    }
}

/**
 * Record a query that was actually dispatched. No-op when history is disabled.
 * Returns the updated list, or null when nothing was written.
 */
export function recordSearch(query) {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return Promise.resolve(null);

    return enqueue(async () => {
        try {
            const settings = await getSyncSettings({ searchHistoryEnabled: true });
            if (!settings.searchHistoryEnabled) return null;

            const current = await readRaw();
            const key = q.toLowerCase();
            const next = [
                { q, t: Date.now() },
                ...current.filter((entry) => entry.q.toLowerCase() !== key)
            ].slice(0, SEARCH_HISTORY_LIMIT);

            await chrome.storage.local.set({ [STORAGE_KEY]: next });
            return next;
        } catch (error) {
            console.warn('[SearchHistory] Failed to record search:', error);
            return null;
        }
    });
}

export function deleteSearchEntry(query) {
    const key = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!key) return Promise.resolve(null);

    return enqueue(async () => {
        try {
            const current = await readRaw();
            const next = current.filter((entry) => entry.q.toLowerCase() !== key);
            await chrome.storage.local.set({ [STORAGE_KEY]: next });
            return next;
        } catch (error) {
            console.warn('[SearchHistory] Failed to delete entry:', error);
            return null;
        }
    });
}

export function clearSearchHistory() {
    return enqueue(async () => {
        try {
            await chrome.storage.local.remove(STORAGE_KEY);
        } catch (error) {
            console.warn('[SearchHistory] Failed to clear history:', error);
        }
    });
}

/**
 * Filter a history list by the current input: prefix matches first, then
 * substring matches, recency order inside each bucket.
 */
export function filterSearchHistory(entries, query, limit = 5) {
    const list = normalizeEntries(entries);
    if (!limit || limit < 1) return [];
    if (!query || typeof query !== 'string') return list.slice(0, limit);

    const needle = query.trim().toLowerCase();
    if (!needle) return list.slice(0, limit);

    const prefix = [];
    const middle = [];
    for (const entry of list) {
        const haystack = entry.q.toLowerCase();
        if (haystack.startsWith(needle)) {
            prefix.push(entry);
        } else if (haystack.includes(needle)) {
            middle.push(entry);
        }
    }

    return [...prefix, ...middle].slice(0, limit);
}
