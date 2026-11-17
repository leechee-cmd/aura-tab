import { modalLayer } from '../platform/modal-layer.js';
import {
    DisposableComponent
} from '../platform/lifecycle.js';
import { t } from '../platform/i18n.js';
import { SYNC_SETTINGS_DEFAULTS, getSyncSettings } from '../platform/settings-contract.js';
import { confirmDialog } from '../shared/confirm-dialog.js';
import { store } from './quicklinks/store.js';
import { createIconElement } from './quicklinks/icon-renderer.js';
import { ICONS, engineMark } from '../shared/icons.js';
import {
    clearSearchHistory,
    deleteSearchEntry,
    filterSearchHistory,
    readSearchHistory,
    recordSearch
} from './search-history.js';
import { fetchSuggestions, normalizeQuery } from './search-suggest.js';

const MODAL_ID = 'engine-switcher';
const SUGGESTION_QUERY_DELAY = 90;
// The panel redraws on 90ms; the network request waits longer, so a burst of typing
// sends one request instead of one per character.
const SUGGEST_NETWORK_DELAY = 120;
const HISTORY_ROWS_TYPING = 3;
const HISTORY_ROWS_RESTING = 5;
const LINK_ROWS_TYPING = 4;
const SUGGEST_ROWS = 5;
// The first-run notice is a row of its own, so one suggestion gives way to it.
const SUGGEST_ROWS_NOTICE = 4;
const NOTICE_KEY = 'searchSuggestionNoticeSeen';


function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
}

/** Write `text` into `parent`, wrapping every case-insensitive hit of `needle`. */
function linkDomain(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '');
    } catch {
        return '';
    }
}

function appendHighlighted(parent, text, needle) {
    if (!needle) {
        parent.appendChild(document.createTextNode(text));
        return;
    }

    const haystack = text.toLowerCase();
    const search = needle.toLowerCase();
    let cursor = 0;
    let hit = haystack.indexOf(search);

    if (hit === -1) {
        parent.appendChild(document.createTextNode(text));
        return;
    }

    while (hit !== -1) {
        if (hit > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, hit)));
        const mark = createElement('mark', 'search-highlight', text.slice(hit, hit + search.length));
        parent.appendChild(mark);
        cursor = hit + search.length;
        hit = haystack.indexOf(search, cursor);
    }

    if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
}

async function readNoticeSeen() {
    try {
        const stored = await chrome.storage.local.get({ [NOTICE_KEY]: false });
        return Boolean(stored[NOTICE_KEY]);
    } catch {
        // Storage trouble must not turn into a notice that greets you every tab.
        return true;
    }
}

/**
 * Shown once per install, not once per render: record it as soon as it has been on screen.
 * The row itself stays for the rest of this page (see _showNotice) so it does not blink away
 * the moment the engine answers and the panel redraws.
 */
function markNoticeSeen(search) {
    if (search._noticeStored) return;
    search._noticeStored = true;
    Promise.resolve(chrome.storage.local.set({ [NOTICE_KEY]: true })).catch(() => {});
}

class Search extends DisposableComponent {
    constructor() {
        super();
        this.searchInput = document.getElementById('searchInput');
        this.searchEngineBtn = document.getElementById('searchEngineBtn');
        this.searchContainer = document.querySelector('.search-container');
        this.suggestionsEl = document.getElementById('searchSuggestions');

        // Engine Switcher Elements
        this.overlay = document.getElementById('engineSwitcherOverlay');
        this.switcher = document.getElementById('engineSwitcher');
        this.engineButtonsContainer = document.getElementById('engineSwitcherButtons');
        this.engineBtns = [];

        // State
        this.currentEngine = 'default';
        this.openInNewTab = false;
        this.selectedIndex = 0;
        this.isOpen = false;

        // Suggestion panel state
        this.suggestionRows = [];
        this.activeSuggestionIndex = -1;
        this.historyEntries = [];
        this._suggestionsOpen = false;
        this._renderGeneration = 0;

        // Engine suggestions: the items on hand belong to _suggestQuery, so a stale list
        // never shows up under a different query while the next answer is in flight.
        this.suggestionsEnabled = SYNC_SETTINGS_DEFAULTS.searchSuggestions;
        this.suggestionItems = [];
        this._suggestQuery = '';
        this._suggestSeq = 0;
        this._suggestAbort = null;
        this._noticeSeen = true;
        this._noticeStored = false;
        this._showNotice = false;
        this._noticeDecided = false;
        this._composing = false;

        // Storage listener manager
        this._storageManager = null;

        // Search engine configurations
        // Note: 'default' label uses i18n, others are brand names
        this.searchEngines = {
            default: { labelKey: 'searchEngineDefault', searchUrl: '' },
            google: { label: 'Google', searchUrl: 'https://www.google.com/search?q=' },
            bing: { label: 'Bing', searchUrl: 'https://www.bing.com/search?q=' },
            baidu: { label: 'Baidu', searchUrl: 'https://www.baidu.com/s?wd=' },
            duckduckgo: { label: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=' },
            yahoo: { label: 'Yahoo', searchUrl: 'https://search.yahoo.com/search?p=' },
            yandex: { label: 'Yandex', searchUrl: 'https://yandex.com/search/?text=' },
            ecosia: { label: 'Ecosia', searchUrl: 'https://www.ecosia.org/search?q=' },
            brave: { label: 'Brave', searchUrl: 'https://search.brave.com/search?q=' },
            naver: { label: 'Naver', searchUrl: 'https://search.naver.com/search.naver?query=' },
            sogou: { label: 'Sogou', searchUrl: 'https://www.sogou.com/web?query=' }
        };
    }

    /**
     * Get localized label for a search engine
     */
    _getEngineLabel(engine) {
        if (engine.labelKey) {
            return t(engine.labelKey);
        }
        return engine.label;
    }

    init() {
        if (this.isDestroyed || this.isInitialized) return;

        this.renderEngineButtons();
        this._syncEngineMark();
        this.loadSavedPreferences();
        this._bindEvents();
        this._bindSuggestions();
        this._initStorageListener();

        // Listen for language changes to re-render engine buttons
        this._events.add(window, 'languageChanged', () => this.renderEngineButtons());

        this._markInitialized();
    }

    renderEngineButtons() {
        if (!this.engineButtonsContainer) return;

        this.engineButtonsContainer.innerHTML = '';
        this.engineBtns = Object.entries(this.searchEngines).map(([key, engine]) => {
            const btn = document.createElement('button');
            btn.className = 'engine-btn';
            btn.dataset.engine = key;
            btn.tabIndex = 0;
            btn.type = 'button';
            const mark = document.createElement('span');
            mark.className = 'engine-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.innerHTML = engineMark(key);
            btn.textContent = this._getEngineLabel(engine);
            btn.prepend(mark);
            this.engineButtonsContainer.appendChild(btn);
            return btn;
        });

        // Restore current selection
        this.engineBtns.forEach((btn, index) => {
            const on = btn.dataset.engine === this.currentEngine;
            btn.classList.toggle('selected', on);
            if (on) this.selectedIndex = index;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    _bindEvents() {
        // Search input events - all managed via _events
        this._events.add(this.searchInput, 'keydown', (e) => this.handleSearch(e));
        this._events.add(this.searchInput, 'focus', () => {
            this.searchContainer.classList.add('focused');
            // refreshHistory is what pulls the list out of storage. Without it the panel
            // renders the empty array the module starts with, so a fresh tab never shows
            // anything until the user types — and typing alone keeps that empty cache.
            void this.openSuggestions({ refreshHistory: true });
        });
        this._events.add(this.searchInput, 'blur', () => {
            this.searchContainer.classList.remove('focused');
            this.closeSuggestions();
        });
        this._events.add(this.searchInput, 'input', () => {
            this._timers.setTimeout('suggestions', () => {
                void this.openSuggestions();
            }, SUGGESTION_QUERY_DELAY);
        });

        // An IME composes 天 in several steps before it commits anything. Asking the engine
        // about every intermediate reading sends nonsense and gets nonsense back; wait for
        // the commit.
        this._events.add(this.searchInput, 'compositionstart', () => {
            this._composing = true;
        });
        this._events.add(this.searchInput, 'compositionend', () => {
            this._composing = false;
            this._timers.setTimeout('suggestions', () => {
                void this.openSuggestions();
            }, SUGGESTION_QUERY_DELAY);
        });

        // The panel fades its own bottom edge while there is more below it.
        if (this.suggestionsEl) {
            this._events.add(this.suggestionsEl, 'scroll', () => this._syncScrollFade());
        }

        // Click search container to focus input (intuitive: click "search box area" = enter input)
        this._events.add(this.searchContainer, 'click', (e) => {
            // Rows activate themselves and close the panel; treating the same click as a
            // box click would reopen it on top of the page the row just navigated to.
            if (!e.target.closest('.search-engine-wrapper') && !e.target.closest('.search-suggestions')) {
                const wasFocused = document.activeElement === this.searchInput;
                this.searchInput.focus();
                // Escape closes the panel without moving focus, so a click on the already
                // focused box fires no focus event and would otherwise leave it closed.
                if (wasFocused) void this.openSuggestions({ refreshHistory: true });
            }
        });

        // Open switcher on button click
        this._events.add(this.searchEngineBtn, 'click', (e) => {
            e.stopPropagation();
            this.openSwitcher();
        });

        // Engine button events (Delegated)
        if (this.engineButtonsContainer) {
            this._events.add(this.engineButtonsContainer, 'click', (e) => {
                const btn = e.target.closest('.engine-btn');
                if (!btn) return;

                const index = this.engineBtns.indexOf(btn);
                if (index !== -1) {
                    this.selectEngine(index);
                    this.closeSwitcher(true);
                }
            });

            this._events.add(this.engineButtonsContainer, 'mouseover', (e) => {
                const btn = e.target.closest('.engine-btn');
                if (!btn) return;

                const index = this.engineBtns.indexOf(btn);
                if (index !== -1) {
                    this.updateHighlight(index);
                }
            });
        }

        // Global keyboard navigation - properly managed now
        this._events.add(document, 'keydown', (e) => this.handleKeyNavigation(e));
    }

    _initStorageListener() {
        this._storageManager = this._getStorageManager();

        this._storageManager.register('search-sync', (changes, areaName) => {
            if (areaName !== 'sync') return;

            if (changes.searchOpenInNewTab) {
                this.setOpenInNewTab(Boolean(changes.searchOpenInNewTab.newValue));
            }

            if (changes.searchSuggestions) {
                const enabled = Boolean(changes.searchSuggestions.newValue);
                this.suggestionsEnabled = enabled;
                if (!enabled) this._dropSuggestions();
                if (this._suggestionsOpen && this.searchInput) {
                    void this._renderSuggestions(this.searchInput.value.trim());
                }
            }

            if (changes.preferredSearchEngine) {
                const engine = changes.preferredSearchEngine.newValue;
                if (typeof engine === 'string') {
                    this.setSearchEngine(engine);
                }
            }
        });
    }

    async loadSavedPreferences() {
        try {
            const settings = await getSyncSettings({
                preferredSearchEngine: SYNC_SETTINGS_DEFAULTS.preferredSearchEngine,
                searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab,
                searchSuggestions: SYNC_SETTINGS_DEFAULTS.searchSuggestions
            });
            this.openInNewTab = settings.searchOpenInNewTab;
            this.suggestionsEnabled = settings.searchSuggestions !== false;

            const engines = Array.from(this.engineBtns).map(btn => btn.dataset.engine);
            const savedIndex = engines.indexOf(settings.preferredSearchEngine);

            if (savedIndex !== -1) {
                this.selectedIndex = savedIndex;
                this.setSearchEngine(settings.preferredSearchEngine);
            }
        } catch {
            // Ignore storage errors
        }
    }

    /**
     * The box shows which engine a search will go to, so the mark has to follow the
     * selection. `default` keeps the magnifier: which engine the browser is set to is
     * not something an extension can read.
     */
    _syncEngineMark() {
        if (!this.searchEngineBtn) return;
        this.searchEngineBtn.innerHTML = engineMark(this.currentEngine);
        this.searchEngineBtn.dataset.engine = this.currentEngine;
    }

    setOpenInNewTab(openInNewTab) {
        this.openInNewTab = Boolean(openInNewTab);
    }

    setSearchEngine(engine) {
        if (!this.searchEngines[engine]) return;

        this.currentEngine = engine;
        this._syncEngineMark();

        this.engineBtns.forEach((btn, index) => {
            if (btn.dataset.engine === engine) {
                btn.classList.add('selected');
                this.selectedIndex = index;
            } else {
                btn.classList.remove('selected');
            }
            btn.setAttribute('aria-pressed', btn.dataset.engine === engine ? 'true' : 'false');
        });

    }

    openSwitcher() {
        if (this.isOpen || this.isDestroyed) return;

        this.isOpen = true;
        this.overlay.classList.add('active');
        this.overlay.setAttribute('aria-hidden', 'false');

        modalLayer.register(
            MODAL_ID,
            modalLayer.constructor.LEVEL.CONTEXT_MENU,
            this.switcher,
            // Outside click close: do not restore focus, avoid focus stealing (click goes where, focus goes where)
            () => this.closeSwitcher(false, { restoreFocus: false })
        );

        this.engineBtns.forEach((btn) => {
            const on = btn.dataset.engine === this.currentEngine;
            btn.classList.toggle('selected', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        const selectedBtn = this.engineBtns[this.selectedIndex];
        if (selectedBtn) {
            selectedBtn.focus();
        }
    }

    closeSwitcher(saveSelection = false, { restoreFocus = true } = {}) {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.overlay.classList.remove('active');

        // Move focus out before aria-hidden: Esc/outside-dismiss can leave focus on .engine-btn otherwise.
        if (this.overlay.contains(document.activeElement)) {
            if (restoreFocus) {
                this.searchInput?.focus();
            } else {
                (/** @type {HTMLElement} */ (document.activeElement)).blur();
            }
        }

        this.overlay.setAttribute('aria-hidden', 'true');

        modalLayer.unregister(MODAL_ID);

        if (!saveSelection) {
            this.loadSavedPreferences();
        }
    }

    async selectEngine(index) {
        if (index < 0 || index >= this.engineBtns.length) return;

        const engine = this.engineBtns[index].dataset.engine;
        try {
            await chrome.storage.sync.set({ preferredSearchEngine: engine });
            this.setSearchEngine(engine);
        } catch (error) {
            console.error('[Search] Failed to save preferred engine:', error);
        }
    }

    updateHighlight(index) {
        if (index < 0 || index >= this.engineBtns.length) return;

        this.selectedIndex = index;

        this.engineBtns.forEach((btn, i) => {
            btn.classList.toggle('selected', i === index);
            // aria-pressed reflects committed selection (currentEngine), not hover/keyboard preview ring.
            btn.setAttribute('aria-pressed', btn.dataset.engine === this.currentEngine ? 'true' : 'false');
        });
    }

    handleKeyNavigation(e) {
        if (!this.isOpen) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                e.stopPropagation();
                this.navigatePrev();
                break;

            case 'ArrowRight':
                e.preventDefault();
                e.stopPropagation();
                this.navigateNext();
                break;

            case 'Tab':
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    this.navigatePrev();
                } else {
                    this.navigateNext();
                }
                break;

            case 'Enter':
                e.preventDefault();
                e.stopPropagation();
                this.selectEngine(this.selectedIndex);
                this.closeSwitcher(true);
                break;
        }
    }

    navigateNext() {
        const nextIndex = (this.selectedIndex + 1) % this.engineBtns.length;
        this.updateHighlight(nextIndex);
        this.engineBtns[nextIndex].focus();
    }

    navigatePrev() {
        const prevIndex = (this.selectedIndex - 1 + this.engineBtns.length) % this.engineBtns.length;
        this.updateHighlight(prevIndex);
        this.engineBtns[prevIndex].focus();
    }

    _bindSuggestions() {
        if (!this.suggestionsEl || !this.searchInput) return;

        this.searchInput.setAttribute('role', 'combobox');
        this.searchInput.setAttribute('aria-autocomplete', 'list');
        this.searchInput.setAttribute('aria-expanded', 'false');
        this.searchInput.setAttribute('aria-controls', 'searchSuggestions');

        // Keep focus in the input while a row is being clicked, so the panel is still
        // rendered when the click handler runs (blur would clear it first).
        this._events.add(this.suggestionsEl, 'mousedown', (e) => e.preventDefault());

        this._events.add(this.suggestionsEl, 'click', (e) => {
            if (e.target.closest('.search-suggestions-off')) {
                e.stopPropagation();
                void this._disableSuggestions();
                return;
            }

            if (e.target.closest('.search-suggestion-del')) {
                e.stopPropagation();
                const owner = e.target.closest('.search-suggestion');
                this._deleteHistoryAt(Number(owner?.dataset.index));
                return;
            }

            const row = e.target.closest('.search-suggestion');
            if (!row) return;
            // Activating a row closes the panel, which detaches this very row from the DOM —
            // so by the time the event bubbles to .search-container, `closest()` can no
            // longer tell where it came from and the container would treat it as a click on
            // the box and reopen the panel. Stop it here instead.
            e.stopPropagation();
            this._activateRow(Number(row.dataset.index));
        });
    }

    /**
     * Reload history and re-render the panel for the current input.
     * Called on focus (refreshHistory) and on every keystroke (cached history).
     */
    async openSuggestions({ refreshHistory = false } = {}) {
        if (this.isDestroyed || !this.suggestionsEl || !this.searchInput) return;
        // Two Escapes can collapse the box while a debounce is still armed.
        if (document.documentElement.dataset.searchOpen === '0') return;

        // The box is open and focused: the panel is allowed to show, even when it currently
        // has nothing to show. A query with no history and no matching links renders an empty
        // panel whose only content is the engine answer still in flight.
        this._suggestionsOpen = true;

        if (refreshHistory) {
            this.historyEntries = await readSearchHistory();
            await this._decideNotice();
        }

        await this._renderSuggestions(this.searchInput.value.trim());
    }

    closeSuggestions() {
        this._renderGeneration += 1;
        // The input and composition handlers arm these two; a keystroke followed by a click
        // away within the delay would otherwise re-render the panel after it was dismissed.
        this._timers.clearTimeout('suggestions');
        this._timers.clearTimeout('suggestNet');
        this._dropSuggestions();
        this._suggestionsOpen = false;
        this.suggestionRows = [];
        this.activeSuggestionIndex = -1;

        if (this.suggestionsEl) {
            this.suggestionsEl.replaceChildren();
            this.suggestionsEl.classList.remove('is-open');
            this.suggestionsEl.setAttribute('aria-hidden', 'true');
        }

        this.searchInput?.setAttribute('aria-expanded', 'false');
        this.searchInput?.removeAttribute('aria-activedescendant');
    }

    async _renderSuggestions(query) {
        if (!this.suggestionsEl || !this.searchInput) return;

        const generation = ++this._renderGeneration;

        let links = [];
        if (query) {
            try {
                // The store is initialised by the quicklinks app on an idle callback, which
                // can run after this module. init() is idempotent, so awaiting it here is safe.
                await store.init();
                if (this.isDestroyed || generation !== this._renderGeneration) return;
                // Over-fetch: store.search() also returns folders, which have no URL to
                // open and would sit in the panel as a row that does nothing.
                links = store.search(query, { limit: LINK_ROWS_TYPING + 2 })
                    .filter((item) => store.getSafeUrl(item?.url))
                    .slice(0, LINK_ROWS_TYPING);
            } catch {
                links = [];
            }
        }
        // Destroyed while store.init() was in flight: the elements are gone.
        if (this.isDestroyed || generation !== this._renderGeneration) return;

        const notice = this._shouldShowNotice();
        const suggestions = this._suggestionsFor(query)
            .slice(0, notice ? SUGGEST_ROWS_NOTICE : SUGGEST_ROWS);

        // History still gives way to the engine's list while typing: the two overlap almost
        // completely, and a list that says "deepseek" twice is worse than a short one. It
        // comes back whenever the engine has nothing — offline, slow, or a query it does
        // not know.
        const historyLimit = !query
            ? HISTORY_ROWS_RESTING
            : (suggestions.length ? 0 : HISTORY_ROWS_TYPING);

        const history = filterSearchHistory(this.historyEntries, query, historyLimit);

        if (!suggestions.length && !history.length && !links.length) {
            this._hidePanel();
            if (query) this._scheduleSuggest(query);
            else this._dropSuggestions();
            return;
        }

        // One flat list, no group headers: the row's own icon says what kind it is, so the
        // groups only added height and repeated themselves in every row.
        const fragment = document.createDocumentFragment();
        this.suggestionRows = [];

        for (const item of links) {
            fragment.appendChild(this._createLinkRow(item, query));
        }
        for (const text of suggestions) {
            fragment.appendChild(this._createSuggestRow(text, query));
        }
        for (const entry of history) {
            fragment.appendChild(this._createHistoryRow(entry, query));
        }
        if (history.length) {
            fragment.appendChild(this._createClearRow());
        }
        if (notice) {
            fragment.appendChild(this._createNoticeRow());
            markNoticeSeen(this);
        }

        this.suggestionsEl.replaceChildren(fragment);
        this.suggestionsEl.classList.add('is-open');
        this.suggestionsEl.setAttribute('aria-hidden', 'false');
        this.searchInput.setAttribute('aria-expanded', 'true');
        this._suggestionsOpen = true;
        this._setActive(-1);
        this._syncScrollFade();

        if (!query) this._dropSuggestions();
        else this._scheduleSuggest(query);
    }

    /**
     * The panel is taller than its room as soon as there is something to scroll to. The
     * fade says so, and steps aside at the very bottom so it never dims the last row
     * once you have arrived there.
     */
    _syncScrollFade() {
        const panel = this.suggestionsEl;
        if (!panel) return;

        const overflowing = panel.scrollHeight - panel.clientHeight > 1;
        const atEnd = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
        panel.dataset.overflow = overflowing && !atEnd ? '1' : '0';
    }

    /** Empty the visible panel without giving up on the answer that is still coming. */
    _hidePanel() {
        this.suggestionRows = [];
        this.activeSuggestionIndex = -1;
        this.suggestionsEl?.replaceChildren();
        if (this.suggestionsEl) this.suggestionsEl.dataset.overflow = '0';
        this.suggestionsEl?.classList.remove('is-open');
        this.suggestionsEl?.setAttribute('aria-hidden', 'true');
        this.searchInput?.setAttribute('aria-expanded', 'false');
        this.searchInput?.removeAttribute('aria-activedescendant');
    }

    /** Suggestions are only valid for the query they were fetched for. */
    _suggestionsFor(query) {
        if (!query || !this.suggestionsEnabled) return [];
        return this._suggestQuery === query.toLowerCase() ? this.suggestionItems : [];
    }

    /** Decided once per page load, so the notice does not vanish on the next redraw. */
    async _decideNotice() {
        if (this._noticeDecided) return;
        this._noticeSeen = await readNoticeSeen();
        this._showNotice = !this._noticeSeen;
        this._noticeDecided = true;
    }

    _shouldShowNotice() {
        return this.suggestionsEnabled && this._showNotice;
    }

    _dropSuggestions() {
        this._suggestSeq += 1;
        this._suggestAbort?.abort();
        this._suggestAbort = null;
        this.suggestionItems = [];
        this._suggestQuery = '';
    }

    _scheduleSuggest(query) {
        if (!this.suggestionsEnabled || this._composing) return;
        // Already holding this query's answer: asking again would render, which schedules
        // again, which asks again — a loop that quietly redraws the panel every 120ms and
        // wipes the keyboard highlight each time.
        if (this._suggestQuery === query.toLowerCase()) return;
        this._timers.setTimeout('suggestNet', () => {
            void this._loadSuggestions(query);
        }, SUGGEST_NETWORK_DELAY);
    }

    async _loadSuggestions(query) {
        const seq = ++this._suggestSeq;
        this._suggestAbort?.abort();
        const controller = new AbortController();
        this._suggestAbort = controller;

        const items = await fetchSuggestions(query, { signal: controller.signal });

        // A newer keystroke, a closed panel, or a query that has since been edited: this
        // answer no longer describes what is on screen.
        if (this.isDestroyed || seq !== this._suggestSeq) return;
        if (!this.searchInput || !this._suggestionsOpen) return;
        const current = normalizeQuery(this.searchInput.value);
        if (current.toLowerCase() !== query.toLowerCase()) return;

        this.suggestionItems = items;
        this._suggestQuery = query.toLowerCase();
        await this._renderSuggestions(current);
    }

    async _disableSuggestions() {
        this.suggestionsEnabled = false;
        this._dropSuggestions();

        try {
            await chrome.storage.sync.set({ searchSuggestions: false });
        } catch (error) {
            console.warn('[Search] Failed to turn suggestions off:', error);
        }

        if (!this.isDestroyed && this.searchInput) {
            await this._renderSuggestions(this.searchInput.value.trim());
        }
    }

    _registerRow(el, data) {
        const index = this.suggestionRows.length;
        el.dataset.index = String(index);
        el.id = `searchSuggestion-${index}`;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', 'false');
        this.suggestionRows.push({ el, ...data });
        return el;
    }

    _createSuggestRow(text, query) {
        const row = createElement('div', 'search-suggestion');

        const icon = createElement('span', 'suggestion-icon suggestion-icon-glyph');
        icon.innerHTML = ICONS.search;

        const label = createElement('span', 'suggestion-text');
        label.appendChild(createElement('span', 'sr-only', t('searchSuggestGroupLabel')));
        appendHighlighted(label, text, query);

        row.append(icon, label);
        return this._registerRow(row, { type: 'suggest', query: text });
    }

    _createNoticeRow() {
        const row = createElement('div', 'search-suggestions-notice');

        const icon = createElement('span', 'suggestion-icon suggestion-icon-glyph');
        icon.innerHTML = ICONS.info;

        const text = createElement('span', 'suggestion-text', t('searchSuggestNotice'));

        const off = createElement('button', 'search-suggestions-off', t('searchSuggestNoticeOff'));
        off.type = 'button';
        off.tabIndex = -1;

        row.append(icon, text, off);
        return row;
    }

    _createHistoryRow(entry, query) {
        const row = createElement('div', 'search-suggestion');

        const icon = createElement('span', 'suggestion-icon suggestion-icon-glyph');
        icon.innerHTML = ICONS.history;

        const text = createElement('span', 'suggestion-text');
        text.appendChild(createElement('span', 'sr-only', t('searchRecent')));
        appendHighlighted(text, entry.q, query);

        const remove = createElement('button', 'search-suggestion-del');
        remove.type = 'button';
        remove.tabIndex = -1;
        remove.setAttribute('aria-label', t('ariaRemoveHistoryItem'));
        remove.innerHTML = ICONS.close;

        row.append(icon, text, remove);
        return this._registerRow(row, { type: 'history', query: entry.q });
    }

    _createLinkRow(item, query) {
        const row = createElement('div', 'search-suggestion');
        const label = item.title || item.url || '';

        // The site's own icon, straight out of the cache the dock already filled — a
        // first letter would make GitHub, Gitea and GitLab all look like "G".
        const icon = createIconElement(item, 'searchlink');

        const text = createElement('span', 'suggestion-text');
        text.appendChild(createElement('span', 'sr-only', t('searchQuickLinks')));
        appendHighlighted(text, label, query);

        const meta = createElement('span', 'search-suggestion-meta', linkDomain(item.url));

        row.append(icon, text, meta);
        return this._registerRow(row, { type: 'link', item });
    }

    /** The one action in the list: clearing the history it sits under. */
    _createClearRow() {
        const row = createElement('div', 'search-suggestion search-suggestion-action');
        row.appendChild(createElement('span', 'suggestion-text', t('searchClearHistoryRow')));
        return this._registerRow(row, { type: 'clear' });
    }

    _setActive(index) {
        this.activeSuggestionIndex = index;

        this.suggestionRows.forEach((row, i) => {
            const active = i === index;
            row.el.classList.toggle('is-active', active);
            row.el.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        const activeEl = this.suggestionRows[index]?.el;
        if (!activeEl) {
            this.searchInput?.removeAttribute('aria-activedescendant');
            return;
        }

        this.searchInput?.setAttribute('aria-activedescendant', activeEl.id);
        if (typeof activeEl.scrollIntoView === 'function') {
            activeEl.scrollIntoView({ block: 'nearest' });
        }
    }

    _moveActive(delta) {
        const count = this.suggestionRows.length;
        if (!count) return;

        const current = this.activeSuggestionIndex;
        const next = current < 0
            ? (delta > 0 ? 0 : count - 1)
            : (current + delta + count) % count;

        this._setActive(next);
    }

    _activateRow(index) {
        const row = this.suggestionRows[index];
        if (!row) return;

        if (row.type === 'link') {
            this._openLink(row.item);
            return;
        }

        if (row.type === 'clear') {
            void this._clearHistory();
            return;
        }

        void this.runSearch(row.query);
    }

    _openLink(item) {
        const safeUrl = store.getSafeUrl(item?.url);
        if (!safeUrl) return;

        this.closeSuggestions();

        const openInNewTab = store.settings?.newTab ?? this.openInNewTab;
        if (openInNewTab) {
            window.open(safeUrl, '_blank', 'noopener,noreferrer');
        } else {
            window.location.href = safeUrl;
        }
    }

    async _deleteHistoryAt(index) {
        const row = this.suggestionRows[index];
        if (!row || row.type !== 'history') return;

        const next = await deleteSearchEntry(row.query);
        if (Array.isArray(next)) this.historyEntries = next;
        if (!this.isDestroyed && this.searchInput) {
            await this._renderSuggestions(this.searchInput.value.trim());
        }
    }

    async _clearHistory() {
        const confirmed = await confirmDialog(t('searchClearHistoryConfirm'), {
            title: t('searchRecent'),
            confirmLabel: t('searchClearHistory'),
            confirmVariant: 'danger'
        });
        if (!confirmed) return;

        await clearSearchHistory();
        this.historyEntries = [];
        if (!this.isDestroyed && this.searchInput) {
            await this._renderSuggestions(this.searchInput.value.trim());
        }
    }

    /** Route panel navigation keys; returns true when the key was consumed. */
    _handleSuggestionKey(e) {
        const hasPanel = this._suggestionsOpen && this.suggestionRows.length > 0;

        switch (e.key) {
            case 'ArrowDown':
                if (!hasPanel) return false;
                e.preventDefault();
                this._moveActive(1);
                return true;

            case 'ArrowUp':
                if (!hasPanel) return false;
                e.preventDefault();
                this._moveActive(-1);
                return true;

            case 'Enter': {
                if (!hasPanel || this.activeSuggestionIndex < 0) return false;
                e.preventDefault();
                this._activateRow(this.activeSuggestionIndex);
                return true;
            }

            case 'Tab': {
                if (!hasPanel) return false;
                const row = this.suggestionRows[this.activeSuggestionIndex];
                if (!row || (row.type !== 'history' && row.type !== 'suggest')) return false;
                e.preventDefault();
                this.searchInput.value = row.query;
                void this._renderSuggestions(row.query);
                return true;
            }

            case 'Escape':
                if (!this._suggestionsOpen || !this.suggestionRows.length) return false;
                e.preventDefault();
                e.stopPropagation();
                this.closeSuggestions();
                return true;

            case 'Delete':
                if (!hasPanel) return false;
                if (this.suggestionRows[this.activeSuggestionIndex]?.type !== 'history') return false;
                e.preventDefault();
                void this._deleteHistoryAt(this.activeSuggestionIndex);
                return true;

            default:
                return false;
        }
    }

    handleSearch(e) {
        // Enter that commits an IME candidate belongs to the input method, not to us.
        if (e.isComposing || this._composing) return;
        if (this._handleSuggestionKey(e)) return;
        if (e.key !== 'Enter') return;

        e.preventDefault();
        void this.runSearch(this.searchInput?.value);
    }

    async runSearch(rawQuery) {
        const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
        if (!query) return;

        this.closeSuggestions();

        // Await the write: the tab usually navigates away on the next line.
        await recordSearch(query);

        if (this.currentEngine === 'default') {
            try {
                await chrome.search.query({
                    text: query,
                    disposition: this.openInNewTab ? 'NEW_TAB' : 'CURRENT_TAB'
                });
                return;
            } catch {
                // Fall back to Google below
            }
        }

        const engine = this.currentEngine === 'default'
            ? this.searchEngines.google
            : (this.searchEngines[this.currentEngine] ?? this.searchEngines.google);
        const searchUrl = engine.searchUrl + encodeURIComponent(query);

        if (this.openInNewTab) {
            window.open(searchUrl, '_blank');
        } else {
            window.location.href = searchUrl;
        }
    }

    // Inherited from DisposableComponent - handles all cleanup automatically
    destroy() {
        if (this.isDestroyed) return;

        // Close switcher if open
        if (this.isOpen) {
            this.closeSwitcher(false);
        }

        // A request in flight would otherwise keep going after the page is gone — and it
        // is exactly the fallback-to-the-other-host path that outlives a teardown.
        this._suggestAbort?.abort();

        // Clear DOM references
        this.searchInput = null;
        this.searchEngineBtn = null;
        this.searchContainer = null;
        this.suggestionsEl = null;
        this.suggestionRows = [];
        this.historyEntries = [];
        this._suggestionsOpen = false;
        this.overlay = null;
        this.switcher = null;
        this.engineButtonsContainer = null;
        this.engineBtns = [];

        // Parent handles: _timers, _events, _tasks, _storage
        super.destroy();
    }
}

export function initSearch() {
    const search = new Search();
    search.init();
    return search;
}
