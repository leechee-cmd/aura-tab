import { beforeEach, describe, expect, it } from 'vitest';
import { getStorageData, resetMocks, setStorageData } from '../setup.js';
import {
    SEARCH_HISTORY_LIMIT,
    clearSearchHistory,
    deleteSearchEntry,
    filterSearchHistory,
    readSearchHistory,
    recordSearch
} from '../../scripts/domains/search-history.js';

function seedHistory(entries) {
    setStorageData({ searchHistory: entries }, 'local');
}

describe('search-history', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('keeps the newest query first and dedupes case-insensitively', async () => {
        await recordSearch('alpha');
        await recordSearch('beta');
        const list = await recordSearch('ALPHA');

        expect(list.map((entry) => entry.q)).toEqual(['ALPHA', 'beta']);
        expect(getStorageData('local').searchHistory.map((entry) => entry.q)).toEqual(['ALPHA', 'beta']);
    });

    it('caps the list and drops the oldest entry', async () => {
        const seeded = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, index) => ({
            q: `query-${index}`,
            t: SEARCH_HISTORY_LIMIT - index
        }));
        seedHistory(seeded);

        const list = await recordSearch('newest');

        expect(list).toHaveLength(SEARCH_HISTORY_LIMIT);
        expect(list[0].q).toBe('newest');
        expect(list.map((entry) => entry.q)).not.toContain(`query-${SEARCH_HISTORY_LIMIT - 1}`);
    });

    it('writes nothing when history is disabled', async () => {
        setStorageData({ searchHistoryEnabled: false });

        const result = await recordSearch('secret');

        expect(result).toBeNull();
        expect(getStorageData('local').searchHistory).toBeUndefined();
    });

    it('ignores blank queries', async () => {
        expect(await recordSearch('   ')).toBeNull();
        expect(await recordSearch(null)).toBeNull();
        expect(getStorageData('local').searchHistory).toBeUndefined();
    });

    it('drops malformed stored entries on read', async () => {
        seedHistory([{ q: '  alpha  ' }, { q: '' }, {}, null, { q: 'beta', t: 'nope' }, 'gamma']);

        const list = await readSearchHistory();

        expect(list).toEqual([
            { q: 'alpha', t: 0 },
            { q: 'beta', t: 0 }
        ]);
    });

    it('deletes one entry without touching the rest', async () => {
        seedHistory([{ q: 'alpha', t: 2 }, { q: 'beta', t: 1 }]);

        const list = await deleteSearchEntry('Alpha');

        expect(list).toEqual([{ q: 'beta', t: 1 }]);
        expect(getStorageData('local').searchHistory).toEqual([{ q: 'beta', t: 1 }]);
    });

    it('clears the whole list', async () => {
        seedHistory([{ q: 'alpha', t: 1 }]);

        await clearSearchHistory();

        expect(getStorageData('local').searchHistory).toBeUndefined();
    });

    it('ranks prefix matches first and respects the limit', () => {
        const entries = [
            { q: 'react hooks', t: 5 },
            { q: 'deep work', t: 4 },
            { q: 'deepseek 官网', t: 3 },
            { q: 'how to deep clean', t: 2 }
        ];

        const matches = filterSearchHistory(entries, 'deep', 2);

        expect(matches.map((entry) => entry.q)).toEqual(['deep work', 'deepseek 官网']);
    });

    it('returns the most recent entries for an empty query', () => {
        const entries = [
            { q: 'one', t: 3 },
            { q: 'two', t: 2 },
            { q: 'three', t: 1 }
        ];

        expect(filterSearchHistory(entries, '', 2).map((entry) => entry.q)).toEqual(['one', 'two']);
        expect(filterSearchHistory(entries, null, 5)).toHaveLength(3);
    });
});
