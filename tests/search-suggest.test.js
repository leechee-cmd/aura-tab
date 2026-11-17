import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SUGGEST_MAX_ITEMS,
    SUGGEST_MAX_QUERY,
    clearSuggestionCache,
    fetchSuggestions,
    getPreferredHost,
    normalizeQuery,
    parseSuggestionResponse
} from '../scripts/domains/search-suggest.js';

const bing = (query, items) => JSON.stringify([query, items]);

function ok(body) {
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('parseSuggestionResponse', () => {
    it('reads the query/list pair Bing answers with', () => {
        const text = bing('deep', ['deepseek', 'deep learning', 'deepmind']);
        expect(parseSuggestionResponse(text, 'deep')).toEqual(['deepseek', 'deep learning', 'deepmind']);
    });

    it('drops the echo of the typed query, which the search row already offers', () => {
        const text = bing('deep', ['deep', 'DeepSeek', 'deepmind']);
        expect(parseSuggestionResponse(text, 'DEEP')).toEqual(['DeepSeek', 'deepmind']);
    });

    it('dedupes case-insensitively, collapses whitespace and skips non-strings', () => {
        const text = bing('q', ['  a  b ', 'A B', 42, null, '', 'c']);
        expect(parseSuggestionResponse(text, 'q')).toEqual(['a b', 'c']);
    });

    it('caps the list at the row budget', () => {
        const many = Array.from({ length: 20 }, (_, i) => `item-${i}`);
        expect(parseSuggestionResponse(bing('q', many), 'q')).toHaveLength(SUGGEST_MAX_ITEMS);
    });

    it('returns nothing for a body that is not the expected shape', () => {
        expect(parseSuggestionResponse('<html>blocked</html>', 'q')).toEqual([]);
        expect(parseSuggestionResponse('{"error":1}', 'q')).toEqual([]);
        expect(parseSuggestionResponse('["q"]', 'q')).toEqual([]);
        expect(parseSuggestionResponse('', 'q')).toEqual([]);
    });
});

describe('normalizeQuery', () => {
    it('trims, flattens control characters and caps the length', () => {
        expect(normalizeQuery('  deep\tseek\n ')).toBe('deep seek');
        expect(normalizeQuery('x'.repeat(200))).toHaveLength(SUGGEST_MAX_QUERY);
        expect(normalizeQuery(null)).toBe('');
    });
});

describe('fetchSuggestions', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        clearSuggestionCache();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('asks Bing for the query and returns the parsed items', async () => {
        const fetchMock = vi.fn(async () => ok(bing('deep', ['deepseek', 'deepmind'])));
        global.fetch = fetchMock;

        const items = await fetchSuggestions(' deep ');

        expect(items).toEqual(['deepseek', 'deepmind']);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.bing.com/osjson.aspx?query=deep');
    });

    it('serves a repeated query from memory instead of asking again', async () => {
        const fetchMock = vi.fn(async () => ok(bing('deep', ['deepseek'])));
        global.fetch = fetchMock;

        await fetchSuggestions('deep');
        await fetchSuggestions('DEEP');

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches an empty answer too, so a bad query is not retried on every keystroke', async () => {
        const fetchMock = vi.fn(async () => ok(bing('zz', [])));
        global.fetch = fetchMock;

        expect(await fetchSuggestions('zz')).toEqual([]);
        expect(await fetchSuggestions('zz')).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never throws: offline, a bad status and a timeout all look like no suggestions', async () => {
        global.fetch = vi.fn(async () => {
            throw new Error('offline');
        });
        expect(await fetchSuggestions('a')).toEqual([]);

        // Both hosts just failed, so the module is in its quiet period; without this reset
        // the two cases below would assert nothing at all and still pass.
        clearSuggestionCache();

        global.fetch = vi.fn(async () => new Response('nope', { status: 429 }));
        expect(await fetchSuggestions('b')).toEqual([]);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        clearSuggestionCache();

        global.fetch = vi.fn((url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        expect(await fetchSuggestions('c', { timeoutMs: 10 })).toEqual([]);
        // One timeout each for both hosts: a hang counts as "this host is no good".
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('falls back to the second host when the first refuses', async () => {
        const urls = [];
        global.fetch = vi.fn(async (url) => {
            urls.push(url);
            if (url.includes('api.bing.com')) throw new Error('reset');
            return ok(bing('deep', ['deepseek']));
        });

        expect(await fetchSuggestions('deep')).toEqual(['deepseek']);
        expect(urls).toEqual([
            'https://api.bing.com/osjson.aspx?query=deep',
            'https://cn.bing.com/osjson.aspx?query=deep'
        ]);
        expect(getPreferredHost()).toContain('cn.bing.com');
    });

    it('falls back when the first host answers with something that is not Bing JSON', async () => {
        global.fetch = vi.fn(async (url) => (
            url.includes('api.bing.com') ? ok('<html>captive portal</html>') : ok(bing('deep', ['deepseek']))
        ));

        expect(await fetchSuggestions('deep')).toEqual(['deepseek']);
    });

    it('stays on the host that worked instead of paying the timeout again', async () => {
        const urls = [];
        global.fetch = vi.fn(async (url) => {
            urls.push(url);
            if (url.includes('api.bing.com')) throw new Error('reset');
            return ok(bing('x', ['one']));
        });

        await fetchSuggestions('first');
        await fetchSuggestions('second');

        expect(urls.filter((u) => u.includes('api.bing.com'))).toHaveLength(1);
        expect(urls.filter((u) => u.includes('cn.bing.com'))).toHaveLength(2);
    });

    it('does not fall back for a well-formed answer that simply has no suggestions', async () => {
        const urls = [];
        global.fetch = vi.fn(async (url) => {
            urls.push(url);
            return ok(bing('zz', []));
        });

        expect(await fetchSuggestions('zz')).toEqual([]);
        expect(urls).toHaveLength(1);
    });

    it('goes quiet for a while when both hosts are down', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('offline');
        });
        global.fetch = fetchMock;

        expect(await fetchSuggestions('a')).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(await fetchSuggestions('b')).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not try the other host after the caller aborted', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn((url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        global.fetch = fetchMock;

        const pending = fetchSuggestions('deep', { signal: controller.signal });
        controller.abort();

        expect(await pending).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not ask for an empty query', async () => {
        const fetchMock = vi.fn(async () => ok(bing('', [])));
        global.fetch = fetchMock;

        expect(await fetchSuggestions('   ')).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gives up when the caller aborts — a newer keystroke replaced this query', async () => {
        const controller = new AbortController();
        global.fetch = vi.fn((url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));

        const pending = fetchSuggestions('deep', { signal: controller.signal });
        controller.abort();

        expect(await pending).toEqual([]);
    });
});
