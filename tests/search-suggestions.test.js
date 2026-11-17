import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, resetMocks, setStorageData } from './setup.js';
import { ICONS, ENGINE_MARKS } from '../scripts/shared/icons.js';

const mocks = vi.hoisted(() => ({
    search: vi.fn(() => []),
    items: []
}));

const confirmDialog = vi.hoisted(() => vi.fn(async () => false));

vi.mock('../scripts/shared/confirm-dialog.js', () => ({ confirmDialog }));

vi.mock('../scripts/domains/quicklinks/store.js', () => ({
    store: {
        init: vi.fn(async () => {}),
        search: (query, options) => mocks.search(query, options),
        getSafeUrl: (url) => url || '',
        settings: { newTab: true }
    }
}));

function mountDom() {
    document.body.innerHTML = `
        <div class="search-container">
            <div class="search-engine-wrapper">
                <button id="searchEngineBtn"></button>
            </div>
            <input id="searchInput">
            <div class="search-suggestions" id="searchSuggestions"></div>
        </div>
        <div id="engineSwitcherOverlay" aria-hidden="true">
            <div id="engineSwitcher"><div id="engineSwitcherButtons"></div></div>
        </div>
    `;
}

const mounted = [];

async function mountSearch() {
    const { initSearch } = await import('../scripts/domains/search.js');
    const search = initSearch();
    mounted.push(search);
    return search;
}

/** innerHTML rewrites `<path />` into `<path></path>`; compare what the DOM makes of both. */
function normalizeMarkup(markup) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    return host.innerHTML;
}

function keyEvent(key) {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

describe('search suggestions', () => {
    beforeEach(() => {
        resetMocks();
        vi.resetModules();
        mocks.search.mockReset();
        mocks.search.mockReturnValue([]);
        chrome.search = { query: vi.fn(async () => {}) };
        mountDom();
    });

    afterEach(() => {
        // Tear down even when the test threw on its way to its own destroy(): a pending
        // timer here fires into whatever the *next* test installs as `fetch`.
        while (mounted.length) {
            try { mounted.pop().destroy(); } catch { /* already gone */ }
        }
        delete globalThis.fetch;
    });

    it('lists recent searches as soon as the box opens', async () => {
        setStorageData({ searchHistory: [{ q: 'deepseek 官网', t: 3 }, { q: 'react hooks', t: 2 }] }, 'local');
        const search = await mountSearch();

        await search.openSuggestions({ refreshHistory: true });

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['history', 'history', 'clear']);
        expect(document.getElementById('searchSuggestions')?.classList.contains('is-open')).toBe(true);
        expect(document.getElementById('searchSuggestions')?.getAttribute('aria-hidden')).toBe('false');

        search.destroy();
    });

    it('shows nothing when there is no history and no query', async () => {
        const search = await mountSearch();

        await search.openSuggestions({ refreshHistory: true });

        expect(search.suggestionRows).toHaveLength(0);
        expect(document.getElementById('searchSuggestions').classList.contains('is-open')).toBe(false);
        // The box is still open and focused, so a typed query can still get an answer.
        expect(search._suggestionsOpen).toBe(true);
        search.destroy();
    });

    it('loads history when the box takes focus', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 2 }] }, 'local');
        const search = await mountSearch();

        document.getElementById('searchInput').focus();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['history', 'clear']);
        search.destroy();
    });

    it('reopens the panel when the already focused box is clicked', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 2 }] }, 'local');
        const search = await mountSearch();
        const input = document.getElementById('searchInput');

        input.focus();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(search.suggestionRows).toHaveLength(2);

        input.dispatchEvent(keyEvent('Escape'));
        expect(search.suggestionRows).toHaveLength(0);

        document.querySelector('.search-container').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(search.suggestionRows).toHaveLength(2);
        search.destroy();
    });

    it('offers no "search for…" row: Enter already searches the typed text', async () => {
        const search = await mountSearch();
        search.searchInput.value = 'deep';

        await search.openSuggestions();

        expect(search.suggestionRows).toHaveLength(0);
        // …and Enter still searches what was typed, highlighted row or not.
        await search.runSearch('deep');
        expect(chrome.search.query).toHaveBeenCalledWith({ text: 'deep', disposition: 'CURRENT_TAB' });
        search.destroy();
    });

    it('merges quick link hits into the same keyboard list', async () => {
        mocks.search.mockReturnValue([{ _id: 'x', title: 'Deep Learning 笔记', url: 'https://example.com' }]);
        const search = await mountSearch();
        search.searchInput.value = 'deep';

        await search.openSuggestions();

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['link']);
        expect(search.suggestionRows[0].el.textContent).toContain('Deep Learning');
        search.destroy();
    });

    it('moves the active row across groups and wraps around', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 2 }] }, 'local');
        mocks.search.mockReturnValue([{ _id: 'x', title: 'Alpha site', url: 'https://example.com' }]);
        const search = await mountSearch();
        search.searchInput.value = 'alpha';
        await search.openSuggestions({ refreshHistory: true });

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['link', 'history', 'clear']);

        search.handleSearch(keyEvent('ArrowDown'));
        expect(search.activeSuggestionIndex).toBe(0);

        search.handleSearch(keyEvent('ArrowDown'));
        expect(search.activeSuggestionIndex).toBe(1);

        search.handleSearch(keyEvent('ArrowDown'));
        expect(search.activeSuggestionIndex).toBe(2);

        search.handleSearch(keyEvent('ArrowDown'));
        expect(search.activeSuggestionIndex).toBe(0);

        search.handleSearch(keyEvent('ArrowUp'));
        expect(search.activeSuggestionIndex).toBe(2);
        search.destroy();
    });

    it('closes the panel on Escape before the box collapses', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 1 }] }, 'local');
        const search = await mountSearch();
        await search.openSuggestions({ refreshHistory: true });

        const event = keyEvent('Escape');
        search.handleSearch(event);

        expect(event.defaultPrevented).toBe(true);
        expect(event.cancelBubble).toBe(true);
        expect(search._suggestionsOpen).toBe(false);
        search.destroy();
    });

    it('deletes the highlighted history entry with Delete', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 2 }, { q: 'beta', t: 1 }] }, 'local');
        const search = await mountSearch();
        await search.openSuggestions({ refreshHistory: true });
        search.handleSearch(keyEvent('ArrowDown'));

        search.handleSearch(keyEvent('Delete'));
        await vi.waitFor(() => expect(search.suggestionRows.map((row) => row.type)).toEqual(['history', 'clear']));

        expect(getStorageData('local').searchHistory).toEqual([{ q: 'beta', t: 1 }]);
        search.destroy();
    });

    it('opens the highlighted quick link on Enter instead of searching the raw text', async () => {
        mocks.search.mockReturnValue([{ _id: 'x', title: 'Deep Learning 笔记', url: 'https://example.com' }]);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const search = await mountSearch();
        search.searchInput.value = 'deep';
        await search.openSuggestions();

        search.handleSearch(keyEvent('ArrowDown'));
        search.handleSearch(keyEvent('Enter'));

        expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
        expect(chrome.search.query).not.toHaveBeenCalled();

        openSpy.mockRestore();
        search.destroy();
    });

    it('replaces recent searches with the engine list once an answer lands', async () => {
        setStorageData({ searchHistory: [{ q: 'deepseek 官网', t: 2 }, { q: 'deep learning', t: 1 }] }, 'local');
        const search = await mountSearch();
        search.searchInput.value = 'deep';

        await search.openSuggestions({ refreshHistory: true });
        // Nothing back from the engine yet: history still fills the panel.
        expect(search.suggestionRows.map((row) => row.type)).toEqual(['history', 'history', 'clear']);

        search.suggestionItems = ['deepseek', 'deeplearning ai'];
        search._suggestQuery = 'deep';
        await search._renderSuggestions('deep');

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['suggest', 'suggest']);
        // The first suggestion is what Enter takes, not the typed text.
        expect(search.suggestionRows[0].query).toBe('deepseek');
        search.destroy();
    });

    it('keeps history when the engine has nothing for this query', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 1 }] }, 'local');
        const search = await mountSearch();
        search.searchInput.value = 'alpha';

        search.suggestionItems = [];
        search._suggestQuery = 'alpha';
        await search.openSuggestions({ refreshHistory: true });

        expect(search.suggestionRows.map((row) => row.type)).toEqual(['history', 'clear']);
        search.destroy();
    });

    it('drops an answer that belongs to a query the user has already left', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify(['de', ['deepseek']])));

        const search = await mountSearch();
        search.searchInput.value = 'deepmind';
        await search.openSuggestions();

        // The request for "de" resolves late; the input says "deepmind" by then.
        await search._loadSuggestions('de');

        expect(search.suggestionItems).toEqual([]);
        expect(search.suggestionRows.some((row) => row.type === 'suggest')).toBe(false);

        delete global.fetch;
        search.destroy();
    });

    it('does not re-ask for a query whose answer it already holds', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify(['deep', ['deepseek']])));

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        search._suggestionsOpen = true;
        await search._loadSuggestions('deep');
        await vi.waitFor(() => expect(search.suggestionRows.some((r) => r.type === 'suggest')).toBe(true));

        // Rendering again must not arm another request: that is what kept the panel
        // redrawing every 120ms in the browser and cleared the highlight under the user.
        search._scheduleSuggest('deep');
        search._scheduleSuggest('deep');
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(global.fetch).toHaveBeenCalledTimes(1);

        delete global.fetch;
        search.destroy();
    });

    it('fills the input with a suggestion on Tab so it can be edited', async () => {
        const search = await mountSearch();
        search.searchInput.value = 'deep';
        search.suggestionItems = ['deepseek api'];
        search._suggestQuery = 'deep';
        await search._renderSuggestions('deep');

        search.handleSearch(keyEvent('ArrowDown'));
        search.handleSearch(keyEvent('Tab'));

        expect(search.searchInput.value).toBe('deepseek api');
        search.destroy();
    });

    it('explains itself once, and turns the setting off from that row', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 1 }] }, 'local');
        const search = await mountSearch();
        await search.openSuggestions({ refreshHistory: true });

        const notice = document.querySelector('.search-suggestions-notice');
        expect(notice).not.toBeNull();
        expect(getStorageData('local').searchSuggestionNoticeSeen).toBe(true);

        // It stays for this page: a redraw when the engine answers must not make it blink.
        await search._renderSuggestions('');
        expect(document.querySelector('.search-suggestions-notice')).not.toBeNull();

        // …but the next tab starts without it.
        const again = await mountSearch();
        await again.openSuggestions({ refreshHistory: true });
        expect(document.querySelector('.search-suggestions-notice')).toBeNull();

        search.destroy();
        again.destroy();
    });

    it('turns suggestions off from the notice row', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 1 }] }, 'local');
        const search = await mountSearch();
        await search.openSuggestions({ refreshHistory: true });

        document.querySelector('.search-suggestions-off').click();
        await vi.waitFor(() => expect(search.suggestionsEnabled).toBe(false));

        expect(getStorageData('sync').searchSuggestions).toBe(false);
        expect(document.querySelector('.search-suggestions-notice')).toBeNull();
        expect(search.suggestionRows.every((row) => row.type !== 'suggest')).toBe(true);
        search.destroy();
    });

    it('does not ask the engine mid-composition', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify(['tian', ['天气预报']])));

        const search = await mountSearch();
        search.searchInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        search.searchInput.value = 'tian';
        search._scheduleSuggest('tian');

        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(global.fetch).not.toHaveBeenCalled();

        search.searchInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(global.fetch).toHaveBeenCalledTimes(1);

        delete global.fetch;
        search.destroy();
    });

    it('has a mark for every engine the box offers, and no leftovers', async () => {
        const search = await mountSearch();
        const offered = Object.keys(search.searchEngines).filter((key) => key !== 'default').sort();
        // Adding an engine without adding its mark used to fail silently: the button just
        // kept the magnifier and nothing said why.
        expect(offered).toEqual(Object.keys(ENGINE_MARKS).sort());
        search.destroy();
    });

    it('shows which engine the search will go to, and follows a switch', async () => {
        const search = await mountSearch();
        const button = document.getElementById('searchEngineBtn');

        // "default" has no brand of its own: the box keeps the magnifier.
        expect(normalizeMarkup(button.innerHTML)).toBe(normalizeMarkup(ICONS.search));
        expect(button.dataset.engine).toBe('default');

        search.setSearchEngine('duckduckgo');

        expect(normalizeMarkup(button.innerHTML)).toBe(normalizeMarkup(ENGINE_MARKS.duckduckgo));
        expect(button.dataset.engine).toBe('duckduckgo');
        // …and the switcher keeps a mark on every row, not just the chosen one.
        const marks = [...document.querySelectorAll('#engineSwitcherButtons .engine-btn .engine-mark svg')];
        expect(marks).toHaveLength(11);
        search.destroy();
    });

    it('lists matching links first, and no more than four', async () => {
        mocks.search.mockReturnValue(Array.from({ length: 6 }, (_, i) => ({
            _id: `x${i}`,
            title: `Deep site ${i}`,
            url: `https://deep${i}.example`
        })));

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        await search.openSuggestions();

        expect(search.suggestionRows).toHaveLength(4);
        expect(search.suggestionRows.every((row) => row.type === 'link')).toBe(true);
        expect(mocks.search).toHaveBeenCalledWith('deep', expect.objectContaining({ limit: expect.any(Number) }));
        search.destroy();
    });

    it('opens the link a row stands for, and closes the panel', async () => {
        mocks.search.mockReturnValue([{ _id: 'qlink_gh', title: 'GitHub', url: 'https://github.com/leech/aura-tab' }]);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        const search = await mountSearch();
        search.searchInput.value = 'github';
        await search.openSuggestions();

        search.handleSearch(keyEvent('ArrowDown'));
        search.handleSearch(keyEvent('Enter'));

        expect(openSpy).toHaveBeenCalledWith('https://github.com/leech/aura-tab', '_blank', 'noopener,noreferrer');
        expect(search._suggestionsOpen).toBe(false);

        openSpy.mockRestore();
        search.destroy();
    });

    it('gives a link row the site icon instead of a letter box', async () => {
        mocks.search.mockReturnValue([{ _id: 'qlink_gh', title: 'GitHub', url: 'https://github.com/leech/aura-tab' }]);

        const search = await mountSearch();
        search.searchInput.value = 'github';
        await search.openSuggestions();

        const row = search.suggestionRows[0].el;
        expect(row.querySelector('.searchlink-icon')).not.toBeNull();
        expect(row.querySelector('.suggestion-initial')).toBeNull();
        search.destroy();
    });

    it('says the row type out loud without showing it', async () => {
        mocks.search.mockReturnValue([{ _id: 'qlink_gh', title: 'GitHub', url: 'https://github.com' }]);
        setStorageData({ searchHistory: [{ q: 'github login', t: 1 }] }, 'local');

        const search = await mountSearch();
        search.searchInput.value = 'github';
        await search.openSuggestions({ refreshHistory: true });

        const hints = search.suggestionRows.map((row) => row.el.querySelector('.sr-only')?.textContent ?? null);
        // link, then history — each carries a spoken type, and neither shows it on screen
        expect(hints[0]).toBe('searchQuickLinks');
        expect(hints).toContain('searchRecent');
        search.destroy();
    });

    it('shows the domain next to a link so a URL match makes sense', async () => {
        mocks.search.mockReturnValue([{ _id: 'x', title: 'aura-tab', url: 'https://www.github.com/leech/aura-tab' }]);

        const search = await mountSearch();
        search.searchInput.value = 'github';
        await search.openSuggestions();

        const meta = search.suggestionRows[0].el.querySelector('.search-suggestion-meta');
        expect(meta.textContent).toBe('github.com');
        search.destroy();
    });

    it('puts the clear-history row last and asks before wiping', async () => {
        setStorageData({ searchHistory: [{ q: 'alpha', t: 2 }] }, 'local');
        const search = await mountSearch();
        await search.openSuggestions({ refreshHistory: true });

        const last = search.suggestionRows.at(-1);
        expect(last.type).toBe('clear');
        expect(last.el.textContent).toBe('searchClearHistoryRow');

        search.handleSearch(keyEvent('ArrowDown'));
        search.handleSearch(keyEvent('ArrowDown'));
        expect(search.activeSuggestionIndex).toBe(1);

        search.handleSearch(keyEvent('Enter'));
        await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
        // Nothing is gone until the dialog says so.
        expect(getStorageData('local').searchHistory).toEqual([{ q: 'alpha', t: 2 }]);
        search.destroy();
    });

    it('stops asking the engine once the module is gone', async () => {
        let signal;
        globalThis.fetch = vi.fn((url, options) => {
            signal = options.signal;
            return new Promise(() => {});
        });

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        search._suggestionsOpen = true;
        void search._loadSuggestions('deep');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(signal.aborted).toBe(false);
        search.destroy();
        expect(signal.aborted).toBe(true);
    });

    it('does not bring the panel back after it was dismissed', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify(['deep', ['deepseek']])));

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        // A keystroke arms the 90ms debounce; the user clicks away before it fires.
        search.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        search.searchInput.dispatchEvent(new Event('blur'));

        await new Promise((resolve) => setTimeout(resolve, 250));

        expect(search.suggestionRows).toHaveLength(0);
        expect(document.getElementById('searchSuggestions').classList.contains('is-open')).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();

        delete global.fetch;
        search.destroy();
    });

    it('does not reopen the panel when a row is clicked', async () => {
        mocks.search.mockReturnValue([{ _id: 'x', title: 'Deep Learning 笔记', url: 'https://example.com' }]);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        await search.openSuggestions();

        // The click bubbles to the container, which is also a "focus the box" target.
        search.suggestionRows[0].el.click();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(search._suggestionsOpen).toBe(false);
        expect(search.suggestionRows).toHaveLength(0);

        openSpy.mockRestore();
        search.destroy();
    });

    it('leaves out candidates that cannot be opened, such as folders', async () => {
        mocks.search.mockReturnValue([
            { _id: 'f', type: 'folder', title: 'Deep 文件夹' },
            { _id: 'x', title: 'Deep Learning 笔记', url: 'https://example.com' }
        ]);

        const search = await mountSearch();
        search.searchInput.value = 'deep';
        await search.openSuggestions();

        expect(search.suggestionRows).toHaveLength(1);
        expect(search.suggestionRows[0].el.textContent).toContain('Deep Learning');
        search.destroy();
    });

    it('leaves the Enter that commits an IME candidate to the input method', async () => {
        const search = await mountSearch();
        search.searchInput.value = '天气';

        search.handleSearch(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));

        expect(chrome.search.query).not.toHaveBeenCalled();
        search.destroy();
    });

    it('records the query then asks the default engine', async () => {
        const search = await mountSearch();
        await search.runSearch('deep work');

        expect(getStorageData('local').searchHistory).toEqual([
            expect.objectContaining({ q: 'deep work' })
        ]);
        expect(chrome.search.query).toHaveBeenCalledWith({ text: 'deep work', disposition: 'CURRENT_TAB' });
        search.destroy();
    });
});
