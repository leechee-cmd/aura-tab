/**
 * The new-tab shell's LayoutManager: search visibility and the corner zones, the shortcut
 * table that drives it, the photo-info timeout path, and keeping the favorite button in sync
 * with the background that just got applied.
 *
 * Two module fakes apply to this whole file, both narrow enough to be safe:
 * - `library-store.js` is only reached from layout.js's photo-info / favorite paths, and the
 *   fake mirrors what an empty store answers.
 * - `quicklinks/launchpad.js` is imported by layout.js for exactly one call,
 *   `launchpad.toggle({ focusSearch: true })`, which the fake provides.
 * Anything this file stops executing shows up as lost coverage on `layout.js` or
 * `library-store.js`, which is how these two fakes stay honest.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/shell/layout-background-favorite-sync.test.js
 *   tests/shell/layout-photo-info-timeout-silent.test.js
 *   tests/shell/layout-search-visibility.test.js
 *   tests/shell/layout-shortcuts.test.js
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, setStorageData } from '../setup.js';
import { LayoutManager } from '../../scripts/domains/layout.js';

const favoriteState = vi.hoisted(() => ({
    ids: new Set(),
    added: []
}));

const mocks = vi.hoisted(() => ({
    launchpadToggle: vi.fn()
}));

// ===== from tests/shell/layout-background-favorite-sync.test.js =====
vi.mock('../../scripts/domains/backgrounds/library-store.js', () => ({
    libraryStore: {
        init: vi.fn(async () => {}),
        has: vi.fn((id) => favoriteState.ids.has(id)),
        count: vi.fn(() => favoriteState.ids.size),
        get: vi.fn(() => null),
        remove: vi.fn(async (id) => favoriteState.ids.delete(id)),
        addRemoteFavoriteFromBackground: vi.fn(async (background) => {
            favoriteState.ids.add(background.id);
            favoriteState.added.push(background.id);
            return true;
        }),
        addLocalFavoriteFromBackground: vi.fn(async (background) => {
            favoriteState.ids.add(background.id);
            favoriteState.added.push(background.id);
            return true;
        })
    }
}));

describe('Layout background favorite synchronization', () => {
    beforeEach(() => {
        resetMocks();
        favoriteState.ids.clear();
        favoriteState.added.length = 0;
        setStorageData({
            backgroundSettings: { type: 'unsplash' }
        }, 'sync');
        document.body.innerHTML = `
            <div class="layout-container"></div>
            <div id="searchContainer"></div>
            <input id="searchInput">
            <div id="photoInfo" class="hidden">
                <a id="photoAuthor"><span id="authorName"></span></a>
                <button id="favoriteBgBtn">
                    <svg class="favorite-icon-empty"></svg>
                    <svg class="favorite-icon-filled hidden"></svg>
                </button>
                <button id="downloadBgBtn"></button>
            </div>
        `;
    });

    it('clears the old favorite state before a click favorites the newly applied background', async () => {
        const { LayoutManager } = await import('../../scripts/domains/layout.js');
        const previous = { id: 'old-favorite', username: 'Old', page: 'https://old.example' };
        const applied = { id: 'new-background', username: 'New', page: 'https://new.example' };
        let current = previous;
        favoriteState.ids.add(previous.id);

        const layout = new LayoutManager({
            backgroundSystem: {
                whenReady: vi.fn(async () => {}),
                getCurrentBackground: () => current
            }
        });

        try {
            await layout.init();
            await Promise.resolve();
            layout.favoriteBgBtn.classList.add('is-favorited');
            layout.favoriteIconEmpty.classList.add('hidden');
            layout.favoriteIconFilled.classList.remove('hidden');
            expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(true);

            window.dispatchEvent(new CustomEvent('background:applied', {
                detail: { background: applied }
            }));
            await vi.waitFor(() => {
                expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(false);
            });

            current = applied;
            layout.favoriteBgBtn.click();
            await vi.waitFor(() => {
                expect(favoriteState.added).toEqual([applied.id]);
            });
            expect(layout.favoriteBgBtn.classList.contains('is-favorited')).toBe(true);
        } finally {
            layout.destroy();
        }
    });
});

// ===== from tests/shell/layout-photo-info-timeout-silent.test.js =====
function setupLayoutDom() {
    document.body.innerHTML = `
        <div class="layout-container"></div>
        <div id="searchContainer"></div>
        <input id="searchInput" />
        <div id="photoInfo"></div>
        <a id="photoAuthor"></a>
        <span id="authorName"></span>
    `;
}

describe('LayoutManager photo info update', () => {
    it('stays silent for background readiness timeout', async () => {
        setupLayoutDom();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const backgroundSystem = {
            whenReady: vi.fn(async () => {
                throw new Error('Background system initialization timeout');
            }),
            getCurrentBackground: vi.fn(() => null)
        };

        const manager = new LayoutManager({ backgroundSystem });
        await manager._updatePhotoInfo();

        expect(backgroundSystem.whenReady).toHaveBeenCalledWith(5000);
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });
});

// ===== from tests/shell/layout-search-visibility.test.js =====
function setupDom() {
    document.body.innerHTML = `
        <div class="layout-container"></div>
        <div id="searchContainer"></div>
        <input id="searchInput" />
        <div class="corner-zone corner-bottom-right" id="cornerBottomRight">
            <button id="searchToggleBtn"></button>
        </div>
    `;
    delete document.documentElement.dataset.searchOpen;
}

function searchIsOpen() {
    return document.documentElement.dataset.searchOpen === '1';
}

function cornerClasses() {
    const corner = document.getElementById('cornerBottomRight');
    return {
        disabled: corner?.classList.contains('disabled') === true,
        alwaysVisible: corner?.classList.contains('always-visible') === true
    };
}

describe('search UI on a fresh tab', () => {
    beforeEach(() => {
        resetMocks();
        setupDom();
        localStorage.clear();
    });

    it('starts on the light line when nothing is stored', async () => {
        const manager = new LayoutManager();

        await manager._initSearchUi();

        expect(manager.isSearchActive).toBe(false);
        expect(searchIsOpen()).toBe(false);
        expect(chrome.storage.sync.set).toHaveBeenCalledWith({ searchAlwaysVisible: false });
        expect(localStorage.getItem('aura:searchAlwaysVisible')).toBe('0');
        manager.destroy();
    });

    it('opens the box when the setting is on', async () => {
        setStorageData({ searchAlwaysVisible: true, showCornerSearch: false });
        const manager = new LayoutManager();

        await manager._initSearchUi();

        expect(manager.isSearchActive).toBe(true);
        expect(searchIsOpen()).toBe(true);
        expect(localStorage.getItem('aura:searchAlwaysVisible')).toBe('1');
        manager.destroy();
    });

    it('migrates a legacy "search box was left open" state into the setting', async () => {
        setStorageData({ searchActive: true });
        const manager = new LayoutManager();

        await manager._initSearchUi();

        expect(manager.isSearchActive).toBe(true);
        expect(chrome.storage.sync.set).toHaveBeenCalledWith({ searchAlwaysVisible: true });
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith('searchActive');
        manager.destroy();
    });

    it('drops the legacy key without opening the box when it was hidden', async () => {
        setStorageData({ searchActive: false });
        const manager = new LayoutManager();

        await manager._initSearchUi();

        expect(manager.isSearchActive).toBe(false);
        expect(chrome.storage.sync.set).toHaveBeenCalledWith({ searchAlwaysVisible: false });
        manager.destroy();
    });

    it('hides the corner button unless the setting says otherwise', async () => {
        const manager = new LayoutManager();
        await manager._initSearchUi();

        // `disabled` is what takes the zone out of the layout, so a hidden button cannot
        // come back when the pointer strays into the corner.
        expect(cornerClasses()).toEqual({ disabled: true, alwaysVisible: false });
        expect(chrome.storage.sync.set).toHaveBeenCalledWith({ showCornerSearch: false });
        manager.destroy();

        resetMocks();
        setupDom();
        setStorageData({ searchAlwaysVisible: false, showCornerSearch: true });
        const shown = new LayoutManager();
        await shown._initSearchUi();

        expect(cornerClasses()).toEqual({ disabled: false, alwaysVisible: true });
        shown.destroy();
    });

    it('applies the two corner states', () => {
        const manager = new LayoutManager();

        manager._applyCornerSearch(false);
        expect(cornerClasses()).toEqual({ disabled: true, alwaysVisible: false });

        manager._applyCornerSearch(true);
        expect(cornerClasses()).toEqual({ disabled: false, alwaysVisible: true });

        manager.destroy();
    });
});

// ===== from tests/shell/layout-shortcuts.test.js =====
vi.mock('../../scripts/domains/quicklinks/launchpad.js', () => ({
    launchpad: {
        toggle: mocks.launchpadToggle
    }
}));

// Named apart because the search-visibility suite above builds a richer DOM, and silently
// sharing one of the two would make one suite assert against the other's markup.
function setupShortcutDom() {
    document.body.innerHTML = `
        <div class="layout-container"></div>
        <div id="searchContainer"></div>
        <input id="searchInput" />
    `;
}

function createKeyEvent(init = {}) {
    return new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init
    });
}

describe('layout shortcuts', () => {
    beforeEach(() => {
        setupShortcutDom();
        mocks.launchpadToggle.mockReset();
    });

    it('opens launchpad with configured shortcut', () => {
        const manager = new LayoutManager();
        manager._shortcuts = {
            focusSearch: 'Alt+KeyL',
            openLaunchpad: 'Alt+Period'
        };

        const event = createKeyEvent({ key: '.', code: 'Period', altKey: true });
        manager._handleKeydown(event);

        expect(event.defaultPrevented).toBe(true);
        expect(mocks.launchpadToggle).toHaveBeenCalledWith({ focusSearch: true });
    });

    it('focuses search with configured shortcut', () => {
        const manager = new LayoutManager();
        manager._shortcuts = {
            focusSearch: 'Alt+KeyL',
            openLaunchpad: 'Alt+Period'
        };
        const toggleSearchSpy = vi.spyOn(manager, 'toggleSearch').mockImplementation(() => { });

        const event = createKeyEvent({ key: 'l', code: 'KeyL', altKey: true });
        manager._handleKeydown(event);

        expect(event.defaultPrevented).toBe(true);
        expect(toggleSearchSpy).toHaveBeenCalledWith(true, { focus: true });
    });

    it('keeps the search box state per page instead of persisting it', () => {
        const manager = new LayoutManager();
        chrome.storage.sync.set.mockClear();

        manager.toggleSearch(true);
        expect(manager.isSearchActive).toBe(true);
        expect(document.documentElement.dataset.searchOpen).toBe('1');

        manager.toggleSearch(false);
        expect(manager.isSearchActive).toBe(false);
        expect(document.documentElement.dataset.searchOpen).toBe('0');

        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        manager.destroy();
    });
});
