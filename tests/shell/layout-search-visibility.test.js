import { beforeEach, describe, expect, it } from 'vitest';
import { resetMocks, setStorageData } from '../setup.js';
import { LayoutManager } from '../../scripts/domains/layout.js';

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
