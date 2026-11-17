/**
 * The settings data layer: the defaults contract that every page reads, and the builder that
 * turns a section description into controls and writes changes back through the repo.
 *
 * The builder case fakes `settings-repo.js` and `i18n.js` for the whole file; neither module
 * is imported by `settings-contract.js`, so the contract case still runs against the real
 * defaults. `settings-repo.test.js` stays a separate file for the opposite reason — it tests
 * that module directly.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/settings/settings-contract.test.js
 *   tests/settings/settings-builder.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, setStorageData } from '../setup.js';
import { DEFAULT_SETTINGS as BACKGROUND_DEFAULT_SETTINGS } from '../../scripts/domains/backgrounds/types.js';
import { SettingsBuilder } from '../../scripts/domains/settings/builder.js';
import {
    SYNC_SETTINGS_DEFAULTS,
    createBackgroundSettingsDefaults,
    getSyncSettings,
    resolveSyncSettingsDefaults
} from '../../scripts/platform/settings-contract.js';

// ===== from tests/settings/settings-contract.test.js =====
describe('settings-contract', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('createBackgroundSettingsDefaults should mirror runtime background defaults', () => {
        const defaults = createBackgroundSettingsDefaults();

        expect(defaults).toEqual({
            ...BACKGROUND_DEFAULT_SETTINGS,
            texture: { ...(BACKGROUND_DEFAULT_SETTINGS.texture || {}) },
            apiKeys: { ...(BACKGROUND_DEFAULT_SETTINGS.apiKeys || {}) }
        });
        expect(defaults).not.toBe(BACKGROUND_DEFAULT_SETTINGS);
        expect(defaults.texture).not.toBe(BACKGROUND_DEFAULT_SETTINGS.texture);
        expect(defaults.apiKeys).not.toBe(BACKGROUND_DEFAULT_SETTINGS.apiKeys);
    });

    it('resolveSyncSettingsDefaults should fill contract defaults for undefined values', () => {
        const resolved = resolveSyncSettingsDefaults({
            showCornerSearch: undefined,
            showSettingsBtn: undefined,
            backgroundSettings: undefined
        });

        expect(resolved.showCornerSearch).toBe(SYNC_SETTINGS_DEFAULTS.showCornerSearch);
        expect(resolved.showSettingsBtn).toBe(SYNC_SETTINGS_DEFAULTS.showSettingsBtn);
        expect(resolved.backgroundSettings).toEqual(createBackgroundSettingsDefaults());
    });

    it('resolveSyncSettingsDefaults should provide all contract defaults when request is empty', () => {
        const resolved = resolveSyncSettingsDefaults();

        expect(resolved).toEqual({
            clockFormat: SYNC_SETTINGS_DEFAULTS.clockFormat,
            dateFormat: SYNC_SETTINGS_DEFAULTS.dateFormat,
            showSeconds: SYNC_SETTINGS_DEFAULTS.showSeconds,
            preferredSearchEngine: SYNC_SETTINGS_DEFAULTS.preferredSearchEngine,
            searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab,
            searchAlwaysVisible: SYNC_SETTINGS_DEFAULTS.searchAlwaysVisible,
            showCornerSearch: SYNC_SETTINGS_DEFAULTS.showCornerSearch,
            searchHistoryEnabled: SYNC_SETTINGS_DEFAULTS.searchHistoryEnabled,
            searchSuggestions: SYNC_SETTINGS_DEFAULTS.searchSuggestions,
            showSettingsBtn: SYNC_SETTINGS_DEFAULTS.showSettingsBtn,
            launchpadShowNames: SYNC_SETTINGS_DEFAULTS.launchpadShowNames,
            'shortcuts.focusSearch': SYNC_SETTINGS_DEFAULTS['shortcuts.focusSearch'],
            'shortcuts.openLaunchpad': SYNC_SETTINGS_DEFAULTS['shortcuts.openLaunchpad'],
            macSettingsDismissOnOutsideClick: SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick,
            uiTheme: SYNC_SETTINGS_DEFAULTS.uiTheme,
            interfaceLanguage: SYNC_SETTINGS_DEFAULTS.interfaceLanguage,
            backgroundSettings: createBackgroundSettingsDefaults()
        });
    });

    it('resolveSyncSettingsDefaults should merge partial background settings with runtime defaults', () => {
        const resolved = resolveSyncSettingsDefaults({
            backgroundSettings: {
                overlay: 66,
                texture: { type: 'grid' }
            }
        });

        expect(resolved.backgroundSettings.overlay).toBe(66);
        expect(resolved.backgroundSettings.texture.type).toBe('grid');
        expect(resolved.backgroundSettings.blur).toBe(BACKGROUND_DEFAULT_SETTINGS.blur);
        expect(resolved.backgroundSettings.apiKeys).toEqual({
            ...(BACKGROUND_DEFAULT_SETTINGS.apiKeys || {})
        });
    });

    it('getSyncSettings should return contract defaults when storage keys are missing', async () => {
        setStorageData({}, 'sync');

        const data = await getSyncSettings({
            showCornerSearch: undefined,
            showSettingsBtn: undefined,
            backgroundSettings: undefined
        });

        expect(data.showCornerSearch).toBe(false);
        expect(data.showSettingsBtn).toBe(true);
        expect(data.backgroundSettings.showRefreshButton).toBe(BACKGROUND_DEFAULT_SETTINGS.showRefreshButton);
    });

    it('getSyncSettings should return contract defaults for all primary settings keys', async () => {
        setStorageData({}, 'sync');

        const data = await getSyncSettings({
            showSeconds: undefined,
            searchOpenInNewTab: undefined,
            showSettingsBtn: undefined,
            showCornerSearch: undefined,
            launchpadShowNames: undefined,
            'shortcuts.focusSearch': undefined,
            'shortcuts.openLaunchpad': undefined,
            macSettingsDismissOnOutsideClick: undefined,
            uiTheme: undefined,
            interfaceLanguage: undefined,
            backgroundSettings: undefined
        });

        expect(data).toMatchObject({
            showSeconds: SYNC_SETTINGS_DEFAULTS.showSeconds,
            searchOpenInNewTab: SYNC_SETTINGS_DEFAULTS.searchOpenInNewTab,
            showSettingsBtn: SYNC_SETTINGS_DEFAULTS.showSettingsBtn,
            showCornerSearch: SYNC_SETTINGS_DEFAULTS.showCornerSearch,
            launchpadShowNames: SYNC_SETTINGS_DEFAULTS.launchpadShowNames,
            'shortcuts.focusSearch': SYNC_SETTINGS_DEFAULTS['shortcuts.focusSearch'],
            'shortcuts.openLaunchpad': SYNC_SETTINGS_DEFAULTS['shortcuts.openLaunchpad'],
            macSettingsDismissOnOutsideClick: SYNC_SETTINGS_DEFAULTS.macSettingsDismissOnOutsideClick,
            uiTheme: SYNC_SETTINGS_DEFAULTS.uiTheme,
            interfaceLanguage: SYNC_SETTINGS_DEFAULTS.interfaceLanguage
        });
        expect(data.backgroundSettings).toEqual(createBackgroundSettingsDefaults());
    });
});

// ===== from tests/settings/settings-builder.test.js =====
const mocks = vi.hoisted(() => ({
    t: vi.fn((key) => `i18n:${key}`),
    patchSyncSettings: vi.fn(async () => ({})),
    syncGet: vi.fn(async () => ({})),
    localGet: vi.fn(async () => ({})),
    localSet: vi.fn(async () => true)
}));

vi.mock('../../scripts/platform/i18n.js', () => ({
    t: mocks.t
}));

vi.mock('../../scripts/platform/settings-repo.js', () => ({
    patchSyncSettings: mocks.patchSyncSettings
}));


function mountContainer() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}

// These cases point three chrome.storage entry points at their own doubles. resetMocks() only
// clears data and call history, so without putting the setup.js versions back the contract
// cases above keep reading through them — and an empty read silently drops settings keys.
const setupStorageGet = chrome.storage.sync.get;
const setupLocalGet = chrome.storage.local.get;
const setupLocalSet = chrome.storage.local.set;

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('settings-builder', () => {
    afterEach(() => {
        chrome.storage.sync.get = setupStorageGet;
        chrome.storage.local.get = setupLocalGet;
        chrome.storage.local.set = setupLocalSet;
    });
    beforeEach(() => {
        document.body.innerHTML = '';

        mocks.t.mockReset();
        mocks.t.mockImplementation((key) => `i18n:${key}`);

        mocks.patchSyncSettings.mockReset();
        mocks.patchSyncSettings.mockResolvedValue({});

        mocks.syncGet.mockReset();
        mocks.syncGet.mockResolvedValue({});

        mocks.localGet.mockReset();
        mocks.localGet.mockResolvedValue({});

        mocks.localSet.mockReset();
        mocks.localSet.mockResolvedValue(true);
        chrome.storage.sync.get = mocks.syncGet;
        chrome.storage.local.get = mocks.localGet;
        chrome.storage.local.set = mocks.localSet;
    });

    it('render should output section rows for toggle/select/slider controls', () => {
        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    titleKey: 'settingsSectionTitle',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'macToggleControl',
                            labelKey: 'settingsToggle'
                        },
                        {
                            type: 'select',
                            id: 'macSelectControl',
                            labelKey: 'settingsSelect',
                            options: [
                                { value: 'grid', labelKey: 'settingsOptionGrid' },
                                { value: 'list', labelKey: 'settingsOptionList' }
                            ]
                        },
                        {
                            type: 'slider',
                            id: 'macSliderControl',
                            labelKey: 'settingsSlider',
                            min: 0,
                            max: 100,
                            step: 10,
                            defaultValue: 30,
                            valueId: 'macSliderValue',
                            formatValue: (value) => `${value}%`
                        }
                    ]
                }
            ]
        });

        builder.render();

        expect(container.querySelector('.mac-settings-section-title')?.textContent).toBe('i18n:settingsSectionTitle');
        expect(container.querySelector('#macToggleControl')).toBeTruthy();

        const select = container.querySelector('#macSelectControl');
        expect(select).toBeTruthy();
        expect(Array.from(select.options).map((option) => option.value)).toEqual(['grid', 'list']);

        const slider = container.querySelector('#macSliderControl');
        expect(slider).toBeTruthy();
        expect(container.querySelector('#macSliderValue')?.textContent).toBe('30%');
    });

    it('load should read values from sync/local storage and apply control state', async () => {
        mocks.syncGet.mockResolvedValue({
            showSeconds: false,
            layoutMode: 'list',
            magnifyScale: 40
        });
        mocks.localGet.mockResolvedValue({
            dismissOutside: true
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'showSeconds',
                            storageKey: 'showSeconds',
                            defaultValue: true
                        },
                        {
                            type: 'toggle',
                            id: 'dismissOutside',
                            storageKey: 'dismissOutside',
                            storageArea: 'local',
                            defaultValue: false
                        },
                        {
                            type: 'select',
                            id: 'layoutMode',
                            storageKey: 'layoutMode',
                            defaultValue: 'grid',
                            options: [
                                { value: 'grid', label: 'Grid' },
                                { value: 'list', label: 'List' }
                            ]
                        },
                        {
                            type: 'slider',
                            id: 'magnifyScale',
                            storageKey: 'magnifyScale',
                            defaultValue: 20,
                            min: 0,
                            max: 100,
                            step: 5,
                            fillId: 'magnifyScaleFill',
                            valueId: 'magnifyScaleValue',
                            formatValue: (value) => `${value}%`
                        }
                    ]
                }
            ]
        });

        await builder.init();

        expect(mocks.syncGet).toHaveBeenCalledWith({
            showSeconds: true,
            layoutMode: 'grid',
            magnifyScale: 20
        });
        expect(mocks.localGet).toHaveBeenCalledWith({
            dismissOutside: false
        });

        expect(builder.getById('showSeconds')?.checked).toBe(false);
        expect(builder.getById('dismissOutside')?.checked).toBe(true);
        expect(builder.getById('layoutMode')?.value).toBe('list');

        const slider = builder.getById('magnifyScale');
        const sliderValue = builder.getById('magnifyScaleValue');
        const sliderFill = builder.getById('magnifyScaleFill');

        expect(slider?.value).toBe('40');
        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('40%');
        expect(sliderValue?.textContent).toBe('40%');
        expect(sliderFill?.style.width).toBe('40%');
    });

    it('change should persist sync/local values via settings-repo or chrome.storage', async () => {
        mocks.syncGet.mockResolvedValue({
            showSeconds: false
        });
        mocks.localGet.mockResolvedValue({
            localMode: 'grid'
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'toggle',
                            id: 'showSeconds',
                            storageKey: 'showSeconds',
                            defaultValue: false
                        },
                        {
                            type: 'select',
                            id: 'localMode',
                            storageKey: 'localMode',
                            storageArea: 'local',
                            defaultValue: 'grid',
                            options: [
                                { value: 'grid', label: 'Grid' },
                                { value: 'compact', label: 'Compact' }
                            ]
                        }
                    ]
                }
            ]
        });

        await builder.init();

        const showSeconds = builder.getById('showSeconds');
        const localMode = builder.getById('localMode');

        showSeconds.checked = true;
        showSeconds.dispatchEvent(new Event('change'));

        localMode.value = 'compact';
        localMode.dispatchEvent(new Event('change'));

        await flushAsync();

        expect(mocks.patchSyncSettings).toHaveBeenCalledTimes(1);
        expect(mocks.patchSyncSettings).toHaveBeenCalledWith({ showSeconds: true });

        expect(mocks.localSet).toHaveBeenCalledTimes(1);
        expect(mocks.localSet).toHaveBeenCalledWith({ localMode: 'compact' });
    });

    it('slider input should update percent/value UI and change should persist value', async () => {
        mocks.syncGet.mockResolvedValue({
            zoomScale: 100
        });

        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    rows: [
                        {
                            type: 'slider',
                            id: 'zoomScale',
                            storageKey: 'zoomScale',
                            defaultValue: 75,
                            min: 50,
                            max: 150,
                            step: 5,
                            fillId: 'zoomScaleFill',
                            valueId: 'zoomScaleValue',
                            formatValue: (value) => `${value}px`
                        }
                    ]
                }
            ]
        });

        await builder.init();

        const slider = builder.getById('zoomScale');
        const sliderValue = builder.getById('zoomScaleValue');
        const sliderFill = builder.getById('zoomScaleFill');

        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('50%');
        expect(sliderValue?.textContent).toBe('100px');
        expect(sliderFill?.style.width).toBe('50%');

        slider.value = '140';
        slider.dispatchEvent(new Event('input'));

        expect(slider?.style.getPropertyValue('--mac-slider-percent')).toBe('90%');
        expect(sliderValue?.textContent).toBe('140px');
        expect(sliderFill?.style.width).toBe('90%');

        slider.dispatchEvent(new Event('change'));
        await flushAsync();

        expect(mocks.patchSyncSettings).toHaveBeenCalledTimes(1);
        expect(mocks.patchSyncSettings).toHaveBeenCalledWith({ zoomScale: 140 });
    });

    it('renders a chips row as independently switchable options in one row', async () => {
        mocks.syncGet.mockResolvedValueOnce({ showA: true, showB: false });
        const container = mountContainer();
        const builder = new SettingsBuilder(container, {
            sections: [
                {
                    type: 'section',
                    titleKey: 'section',
                    rows: [
                        {
                            type: 'chips',
                            labelKey: 'corner',
                            items: [
                                { id: 'chipA', chipLabelKey: 'a', storageKey: 'showA', defaultValue: false, hintKey: 'aHint' },
                                { id: 'chipB', chipLabelKey: 'b', storageKey: 'showB', defaultValue: false }
                            ]
                        }
                    ]
                }
            ]
        });

        await builder.init();

        // One row, one label, two switches.
        const row = container.querySelector('.mac-settings-row');
        expect(row.querySelectorAll('.mac-chip')).toHaveLength(2);
        expect(row.querySelectorAll('.mac-settings-row-title')).toHaveLength(1);

        // A chip may carry a hint: drawn from the attribute, and described to assistive tech.
        const chipWithHint = container.querySelector('.mac-chip[data-tooltip]');
        expect(chipWithHint?.dataset.tooltip).toBe('i18n:aHint');
        const input = container.querySelector('#chipA');
        expect(input.getAttribute('aria-describedby')).toBe('chipA-hint');
        expect(container.querySelector('#chipA-hint')?.textContent).toBe('i18n:aHint');
        expect(container.querySelector('.mac-chip:not([data-tooltip])')).toBeTruthy();

        // Each switch reads and writes its own key: the row has no storage of its own.
        expect(builder.getById('chipA').checked).toBe(true);
        expect(builder.getById('chipB').checked).toBe(false);

        const chipB = builder.getById('chipB');
        chipB.checked = true;
        chipB.dispatchEvent(new Event('change'));
        await flushAsync();

        expect(mocks.patchSyncSettings).toHaveBeenCalledWith({ showB: true });
    });
});
