/**
 * Platform runtime: the clock domain, the shortcut table, the storage-listener singleton,
 * the icon fetch bridge and its cache, the icon glyphs, and the backup manager's icon-cache
 * export paths.
 *
 * One file because none of these needs a fake of another, except the favicon mock below —
 * `scripts/shared/favicon.js` is only reached through the icon bridge, and the mock spreads
 * the real module and overrides two functions, so nothing here observes a different module
 * than it did before the merge.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/platform/clock.test.js
 *   tests/platform/shortcut-manager.test.js
 *   tests/platform/storage-listener-manager.test.js
 *   tests/platform/icon-fetch-bridge.test.js
 *   tests/shared/icons.test.js
 *   tests/platform/backup-manager-iconcache-restore-compat.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, resetMocks, setStorageData, triggerStorageChange } from '../setup.js';
import { BackupManager } from '../../scripts/platform/backup-manager.js';
import { IconCacheManager } from '../../scripts/platform/icon-cache.js';
import {
    discoverIconViaBackground,
    fetchIconPayloadViaBackground,
    normalizeIconBinaryPayload
} from '../../scripts/platform/icon-fetch-bridge.js';
import {
    SHORTCUT_DEFAULTS,
    SHORTCUT_SETTING_KEYS,
    formatShortcutForDisplay,
    matchesShortcutEvent,
    normalizeShortcut,
    normalizeShortcutFromEvent,
    resolveShortcutSettings
} from '../../scripts/platform/shortcut-manager.js';
import { ENGINE_MARKS, ICONS, engineMark } from '../../scripts/shared/icons.js';
import { buildIconCacheKey, normalizeIconCacheUrl } from '../../scripts/shared/text.js';

const setImageSrcWithFallbackMock = vi.fn();

vi.mock('../../scripts/shared/favicon.js', async () => {
    const actual = await vi.importActual('../../scripts/shared/favicon.js');
    return {
        ...actual,
        getFaviconUrlCandidates: vi.fn(() => []),
        setImageSrcWithFallback: setImageSrcWithFallbackMock
    };
});

// ===== from tests/platform/clock.test.js =====
describe('clock', () => {
    beforeEach(() => {
        vi.resetModules();
        resetMocks();
        document.body.innerHTML = `
            <div id="clock"></div>
            <div id="date"></div>
            <input id="timeFormatToggle" type="checkbox">
            <input id="showSeconds" type="checkbox">
        `;
    });

    it('does not commit local state when sync write fails', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('quota');
        });

        const { initClock } = await import('../../scripts/domains/clock.js');
        const state = await initClock();

        try {
            await expect(state.setShowSeconds(true)).rejects.toThrow('quota');
            expect(state.settings.showSeconds).toBe(false);
            expect(document.getElementById('showSeconds').checked).toBe(false);
            expect(getStorageData('sync').showSeconds).toBe(false);
        } finally {
            state.destroy();
            chrome.storage.sync.set = originalSet;
        }
    });

    it('preserves concurrent storage updates while a local write is in flight', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        chrome.storage.sync.set = vi.fn(async (items) => {
            await originalSet(items);

            if ('showSeconds' in items) {
                const oldValue = getStorageData('sync').clockFormat;
                setStorageData({
                    ...getStorageData('sync'),
                    clockFormat: '12'
                }, 'sync');
                triggerStorageChange({
                    clockFormat: {
                        oldValue,
                        newValue: '12'
                    }
                }, 'sync');
            }
        });

        const { initClock } = await import('../../scripts/domains/clock.js');
        const state = await initClock();

        try {
            await state.setShowSeconds(true);

            expect(getStorageData('sync')).toMatchObject({
                clockFormat: '12',
                showSeconds: true
            });
            expect(state.settings).toMatchObject({
                clockFormat: '12',
                showSeconds: true
            });
            expect(document.getElementById('timeFormatToggle').checked).toBe(false);
            expect(document.getElementById('showSeconds').checked).toBe(true);
        } finally {
            state.destroy();
            chrome.storage.sync.set = originalSet;
        }
    });

    it('handles a click-triggered persistence failure without an unhandled rejection', async () => {
        setStorageData({
            clockFormat: '24',
            dateFormat: 'en',
            showSeconds: false
        }, 'sync');

        const originalSet = chrome.storage.sync.set;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        chrome.storage.sync.set = vi.fn(async () => {
            throw new Error('quota');
        });

        const { initClock } = await import('../../scripts/domains/clock.js');
        const state = await initClock();

        try {
            document.getElementById('clock').click();
            await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
            expect(state.settings.clockFormat).toBe('24');
        } finally {
            state.destroy();
            errorSpy.mockRestore();
            chrome.storage.sync.set = originalSet;
        }
    });
});

// ===== from tests/platform/shortcut-manager.test.js =====
function createKeyEvent(init = {}) {
    return new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init
    });
}

describe('shortcut-manager', () => {
    it('normalizes shortcut strings into stable format', () => {
        expect(normalizeShortcut('ctrl + k')).toBe('Ctrl+KeyK');
        expect(normalizeShortcut('mod+Period')).toBe('Mod+Period');
        expect(() => normalizeShortcut('KeyK')).toThrow();
        expect(() => normalizeShortcut('Ctrl')).toThrow();
    });

    it('normalizes keyboard events with Mod abstraction', () => {
        const macEvent = createKeyEvent({ key: 'k', code: 'KeyK', metaKey: true });
        const winEvent = createKeyEvent({ key: 'k', code: 'KeyK', ctrlKey: true });

        expect(normalizeShortcutFromEvent(macEvent, { platform: 'MacIntel' })).toBe('Mod+KeyK');
        expect(normalizeShortcutFromEvent(winEvent, { platform: 'Win32' })).toBe('Mod+KeyK');
    });

    it('matches configured shortcuts against keyboard events', () => {
        const event = createKeyEvent({ key: '.', code: 'Period', ctrlKey: true });
        expect(matchesShortcutEvent(event, 'Mod+Period', { platform: 'Win32' })).toBe(true);
        expect(matchesShortcutEvent(event, 'Ctrl+Period', { platform: 'Win32' })).toBe(true);
        expect(matchesShortcutEvent(event, 'Mod+KeyK', { platform: 'Win32' })).toBe(false);
    });

    it('matches platform-native modifier shortcuts after normalization', () => {
        const macEvent = createKeyEvent({ key: 'k', code: 'KeyK', metaKey: true });
        expect(matchesShortcutEvent(macEvent, 'Meta+KeyK', { platform: 'MacIntel' })).toBe(true);
    });

    it('resolves invalid or conflicting stored shortcuts back to defaults', () => {
        const resolved = resolveShortcutSettings({
            [SHORTCUT_SETTING_KEYS.focusSearch]: 'invalid',
            [SHORTCUT_SETTING_KEYS.openLaunchpad]: 'Mod+KeyK'
        });

        expect(resolved.focusSearch).toBe(SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch]);
        expect(resolved.openLaunchpad).toBe(SHORTCUT_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad]);
    });

    it('formats shortcuts for display by platform', () => {
        expect(formatShortcutForDisplay('Mod+Period', { platform: 'MacIntel' })).toBe('⌘ + .');
        expect(formatShortcutForDisplay('Mod+Period', { platform: 'Win32' })).toBe('Ctrl + .');
    });
});

// ===== from tests/platform/storage-listener-manager.test.js =====
describe('StorageListenerManager singleton bus', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('registers only one chrome.storage.onChanged listener across instances', async () => {
        vi.resetModules();
        const { StorageListenerManager } = await import('../../scripts/platform/lifecycle.js');

        const managerA = new StorageListenerManager();
        const managerB = new StorageListenerManager();
        const managerC = new StorageListenerManager();

        const handlerA = vi.fn();
        const handlerB = vi.fn();
        managerA.register('a', handlerA);
        managerB.register('b', handlerB);

        expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
        expect(chrome.storage.onChanged._listeners).toHaveLength(1);

        triggerStorageChange({
            libraryItems: {
                oldValue: {},
                newValue: { id_1: { id: 'id_1' } }
            }
        }, 'local');

        expect(handlerA).toHaveBeenCalledTimes(1);
        expect(handlerB).toHaveBeenCalledTimes(1);

        managerA.destroy();
        managerB.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(0);
        expect(chrome.storage.onChanged._listeners).toHaveLength(1);

        managerC.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
        expect(chrome.storage.onChanged._listeners).toHaveLength(0);
    });
});

// ===== from tests/platform/icon-fetch-bridge.test.js =====
function createStore(initialItems = []) {
    let listener = null;
    const state = { items: initialItems };
    return {
        state,
        subscribe(callback) {
            listener = callback;
            return () => {
                listener = null;
            };
        },
        emit(event, data) {
            listener?.(event, data);
        },
        getAllItems() {
            return state.items;
        }
    };
}

describe('Icon fetch bridge', () => {
    it('icon_bridge_normalizes_arraybuffer_typedarray_number_array', async () => {
        const expectPayload = async (data) => {
            chrome.runtime.sendMessage.mockResolvedValueOnce({
                    success: true,
                    data,
                    contentType: 'image/png'
                });

            const payload = await fetchIconPayloadViaBackground('https://example.com/favicon.ico');
            expect(payload).toBeTruthy();
            expect(Array.from(payload.bytes)).toEqual([1, 2, 3]);
            expect(payload.contentType).toBe('image/png');
        };

        const arrayBuffer = Uint8Array.from([1, 2, 3]).buffer;
        const typedArray = new Uint8Array([1, 2, 3]);
        const numberArray = [1, 2, 3];

        expect(Array.from(normalizeIconBinaryPayload(arrayBuffer))).toEqual([1, 2, 3]);
        expect(Array.from(normalizeIconBinaryPayload(typedArray))).toEqual([1, 2, 3]);
        expect(Array.from(normalizeIconBinaryPayload(numberArray))).toEqual([1, 2, 3]);

        await expectPayload(arrayBuffer);
        await expectPayload(typedArray);
        await expectPayload(numberArray);
    });

    it('icon_bridge_handles_runtime_last_error_silently', async () => {
        chrome.runtime.sendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));

        await expect(fetchIconPayloadViaBackground('https://example.com/favicon.ico')).resolves.toBeNull();
    });

    it('icon_discovery_bridge_returns_blob_and_quality_metadata', async () => {
        chrome.runtime.sendMessage.mockResolvedValueOnce({
            success: true,
            data: [1, 2, 3],
            contentType: 'image/png',
            meta: { sourceKind: 'html-icon', width: 128, height: 128, score: 95 }
        });

        const result = await discoverIconViaBackground('https://example.com/page');

        expect(result?.blob).toBeInstanceOf(Blob);
        expect(result?.blob.size).toBe(3);
        expect(result?.meta).toMatchObject({ sourceKind: 'html-icon', width: 128, score: 95 });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'discoverIcon', url: 'https://example.com/page' });
    });
});

describe('icon cache key', () => {
    it('icon_cache_key_normalizes_only_http_https', () => {
        expect(normalizeIconCacheUrl('https://example.com/a#b')).toBe('https://example.com/a');
        expect(normalizeIconCacheUrl('http://10.0.0.1:8080/path?q=1#hash')).toBe('http://10.0.0.1:8080/path?q=1');
        expect(normalizeIconCacheUrl('ftp://example.com/a')).toBe('');
        expect(normalizeIconCacheUrl('')).toBe('');
    });

    it('icon_cache_key_isolates_same_host_by_port_and_path', () => {
        const k1 = buildIconCacheKey('http://10.0.0.2:8080/a', '');
        const k2 = buildIconCacheKey('http://10.0.0.2:9090/a', '');
        const k3 = buildIconCacheKey('http://10.0.0.2:8080/b', '');

        expect(k1).not.toBe(k2);
        expect(k1).not.toBe(k3);
    });

    it('icon_cache_key_isolates_same_page_by_custom_icon_url', () => {
        const pageUrl = 'http://10.0.0.2:8080/a';
        const k1 = buildIconCacheKey(pageUrl, 'https://assets.local/icon-a.png');
        const k2 = buildIconCacheKey(pageUrl, 'https://assets.local/icon-b.png');
        const k3 = buildIconCacheKey(pageUrl, '');

        expect(k1).not.toBe(k2);
        expect(k1).not.toBe(k3);
    });

    it('icon_cache_key_is_deterministic_and_validated', () => {
        const pageUrl = 'http://10.0.0.2:8080/a?x=1';
        const iconUrl = 'https://assets.local/icon.png';
        const k1 = buildIconCacheKey(pageUrl, iconUrl);
        const k2 = buildIconCacheKey(pageUrl, iconUrl);

        expect(k1).toBeTruthy();
        expect(k1).toBe(k2);
        expect(buildIconCacheKey('not-a-url', iconUrl)).toBe('');
    });
});

describe('icon-renderer cache key wiring', () => {
    beforeEach(() => {
        setImageSrcWithFallbackMock.mockClear();
    });

    it('icon_renderer_createIconElement_should_pass_cache_key', async () => {
        const { createIconElement } = await import('../../scripts/domains/quicklinks/icon-renderer.js');

        createIconElement({
            _id: '1',
            title: 'A',
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/a.png'
        }, 'quicklink');

        createIconElement({
            _id: '2',
            title: 'B',
            url: 'http://10.0.0.2:9090/b',
            icon: 'https://assets.local/b.png'
        }, 'quicklink');

        expect(setImageSrcWithFallbackMock).toHaveBeenCalledTimes(2);
        const firstOptions = setImageSrcWithFallbackMock.mock.calls[0][3];
        const secondOptions = setImageSrcWithFallbackMock.mock.calls[1][3];

        expect(firstOptions.cacheKey).toBe(buildIconCacheKey('http://10.0.0.2:8080/a', 'https://assets.local/a.png'));
        expect(secondOptions.cacheKey).toBe(buildIconCacheKey('http://10.0.0.2:9090/b', 'https://assets.local/b.png'));
        expect(firstOptions.cacheKey).not.toBe(secondOptions.cacheKey);
    });

    it('icon_renderer_updateItemIcon_should_pass_cache_key', async () => {
        const { updateItemIcon } = await import('../../scripts/domains/quicklinks/icon-renderer.js');

        const el = document.createElement('div');
        const iconDiv = document.createElement('div');
        iconDiv.className = 'quicklink-icon';
        el.appendChild(iconDiv);

        updateItemIcon(el, {
            _id: '3',
            title: 'C',
            url: 'http://10.0.0.3:8080/a',
            icon: 'https://assets.local/c.png'
        }, 'quicklink');

        expect(setImageSrcWithFallbackMock).toHaveBeenCalledTimes(1);
        const options = setImageSrcWithFallbackMock.mock.calls[0][3];
        expect(options.cacheKey).toBe(buildIconCacheKey('http://10.0.0.3:8080/a', 'https://assets.local/c.png'));
    });
});

describe('IconCacheManager cleanup by cacheKey', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('icon_cache_cleanup_should_delete_unused_cache_key', async () => {
        const cache = new IconCacheManager();
        const deleteSpy = vi.spyOn(cache, 'delete').mockResolvedValue(undefined);

        const deletedItem = {
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/a.png'
        };

        const store = createStore([]);
        cache.subscribeToStore(store);
        store.emit('itemDeleted', { item: deletedItem });

        await vi.runAllTimersAsync();

        expect(deleteSpy).toHaveBeenCalledTimes(1);
        expect(deleteSpy).toHaveBeenCalledWith(
            buildIconCacheKey(deletedItem.url, deletedItem.icon)
        );

        cache.destroy();
    });

    it('icon_cache_cleanup_should_keep_cache_when_still_referenced', async () => {
        const cache = new IconCacheManager();
        const deleteSpy = vi.spyOn(cache, 'delete').mockResolvedValue(undefined);

        const sharedItem = {
            url: 'http://10.0.0.2:8080/a',
            icon: 'https://assets.local/shared.png'
        };

        const store = createStore([{ ...sharedItem }]);
        cache.subscribeToStore(store);
        store.emit('itemDeleted', { item: sharedItem });

        await vi.runAllTimersAsync();

        expect(deleteSpy).not.toHaveBeenCalled();

        cache.destroy();
    });
});

describe('IconCacheManager default TTL', () => {
    it('uses permanent caching by default', () => {
        const cache = new IconCacheManager();

        expect(cache.isStale({ cachedAt: 0 })).toBe(false);

        cache.destroy();
    });
});

// ===== from tests/shared/icons.test.js =====
/**
 * 图标模块
 *
 * Focus:
 * - 十个引擎各有一个标，`default` 与未知 key 都回落到放大镜
 * - 引擎标不带宽高（尺寸交给 CSS），永远是 24 网格单色
 * - 界面上那四个小图标仍自带尺寸（行高只有 12px，靠 CSS 推不出来）
 */


const BRANDS = ['google', 'bing', 'baidu', 'duckduckgo', 'yahoo', 'yandex', 'ecosia', 'brave', 'naver', 'sogou'];

describe('icons', () => {
    it('has one mark for every engine the settings offer', () => {
        expect(Object.keys(ENGINE_MARKS).sort()).toEqual([...BRANDS].sort());
    });

    it('falls back to the magnifier for "default" and for anything unknown', () => {
        // Which engine the browser itself is set to is not something an extension can
        // read, so there is no honest brand to show.
        expect(engineMark('default')).toBe(ICONS.search);
        expect(engineMark('not-an-engine')).toBe(ICONS.search);
        expect(engineMark(undefined)).toBe(ICONS.search);
    });

    it('leaves the size to CSS so one mark serves the button and the switcher', () => {
        for (const key of ['default', ...BRANDS]) {
            const svg = engineMark(key);
            expect(svg).toContain('viewBox="0 0 24 24"');
            // `stroke-width` is another matter: only a real size attribute is banned here.
            expect(svg).not.toMatch(/\swidth="\d/);
            expect(svg).not.toMatch(/\sheight="\d/);
            expect(svg).toContain('currentColor');
            expect(svg).toContain('aria-hidden="true"');
        }
    });

    it('draws every mark from a single path so it inherits one colour', () => {
        for (const key of BRANDS) {
            expect(ENGINE_MARKS[key].match(/<path /g)).toHaveLength(1);
        }
    });

    it('leaves the size of the small glyphs to CSS as well', () => {
        // The row tiles are 20px; a 12px glyph inside them needs an explicit rule. When
        // the markup carried the size instead, one icon that forgot it (the magnifier)
        // silently stretched to the tile and looked heavier than the clock beside it.
        for (const key of Object.keys(ICONS)) {
            expect(ICONS[key]).not.toMatch(/\swidth="\d/);
            expect(ICONS[key]).not.toMatch(/\sheight="\d/);
        }
    });
});

// ===== from tests/platform/backup-manager-iconcache-restore-compat.test.js =====
function createSyncDataFixture() {
    return {
        quicklinksItems: ['qlink_a', '__PAGE_BREAK__', 'qlink_b'],
        quicklinksActiveSet: 'set1',
        quicklinksChunkSet_set1_index: ['quicklinksChunkSet_set1_0'],
        quicklinksChunkSet_set1_0: {
            qlink_a: {
                _id: 'qlink_a',
                title: 'Example A',
                url: 'https://www.example.com/a',
                icon: ''
            },
            qlink_b: {
                _id: 'qlink_b',
                title: 'Example B',
                url: 'https://example.com/b',
                icon: 'https://cdn.example.com/custom-icon.png'
            }
        }
    };
}

describe('BackupManager icon cache restore compatibility', () => {
    // One case swaps `global.chrome` wholesale to pin the export paths; put the setup.js
    // mock back afterwards instead of relying on this describe running last.
    const originalChrome = global.chrome;

    afterEach(() => {
        global.chrome = originalChrome;
    });

    it('builds lookup map from restored quicklinks chunk set', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(lookup.byHostname.get('example.com')).toBeTruthy();
        expect(lookup.byHostname.get('example.com').has(keyA)).toBe(true);
        expect(lookup.byHostname.get('example.com').has(keyB)).toBe(true);
        expect(lookup.byIconUrl.get('https://cdn.example.com/custom-icon.png').has(keyB)).toBe(true);
    });

    it('restores modern key when legacy entry stores it in id', () => {
        const manager = new BackupManager();
        const modernKey = buildIconCacheKey('https://example.com/path', '');
        const rawEntry = {
            id: modernKey,
            sourceUrl: 'https://example.com/favicon.ico',
            blob: new Blob(['icon'], { type: 'image/png' }),
            cachedAt: 100,
            lastAccessedAt: 200
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, null);
        expect(normalized).toHaveLength(1);
        expect(normalized[0].cacheKey).toBe(modernKey);
        expect(normalized[0].blob).toBeInstanceOf(Blob);
        expect(normalized[0].sourceKind).toBe('legacy');
        expect(normalized[0].discoveryVersion).toBe(0);
    });

    it('preserves favicon discovery metadata from current backups', () => {
        const manager = new BackupManager();
        const cacheKey = buildIconCacheKey('https://example.com/path', '');
        const normalized = manager._normalizeIconCacheEntriesForImport({
            cacheKey,
            sourceUrl: 'https://example.com/favicon.svg',
            sourceKind: 'html-icon',
            mimeType: 'image/svg+xml',
            width: 128,
            height: 128,
            score: 95,
            purpose: 'any',
            discoveryVersion: 1,
            blob: new Blob(['<svg/>'], { type: 'image/svg+xml' })
        }, null);

        expect(normalized[0]).toMatchObject({
            sourceKind: 'html-icon', mimeType: 'image/svg+xml', width: 128,
            height: 128, score: 95, purpose: 'any', discoveryVersion: 1
        });
    });

    it('maps hostname-based legacy entry to all matching quicklinks keys', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const rawEntry = {
            hostname: 'example.com',
            sourceUrl: 'https://www.google.com/s2/favicons?domain=example.com&sz=128',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(keySet.has(keyA)).toBe(true);
        expect(keySet.has(keyB)).toBe(true);
    });

    it('does not fan out modern cache key entries via hostname fallback', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');
        const rawEntry = {
            cacheKey: keyA,
            sourceUrl: 'https://www.google.com/s2/favicons?domain=example.com&sz=128',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        expect(keySet.has(keyA)).toBe(true);
        expect(keySet.has(keyB)).toBe(false);
        expect(normalized).toHaveLength(1);
    });

    it('prefers custom icon url mapping over broad hostname mapping', () => {
        const manager = new BackupManager();
        const syncData = createSyncDataFixture();
        const lookup = manager._buildIconCacheRestoreLookup(syncData);

        const rawEntry = {
            hostname: 'example.com',
            sourceUrl: 'https://cdn.example.com/custom-icon.png',
            blob: new Blob(['icon'], { type: 'image/png' })
        };

        const normalized = manager._normalizeIconCacheEntriesForImport(rawEntry, lookup);
        const keySet = new Set(normalized.map((entry) => entry.cacheKey));

        const keyA = buildIconCacheKey('https://www.example.com/a', '');
        const keyB = buildIconCacheKey('https://example.com/b', 'https://cdn.example.com/custom-icon.png');

        expect(keySet.has(keyB)).toBe(true);
        expect(keySet.has(keyA)).toBe(false);
    });

    it('normalizes plain hostname value without protocol', () => {
        const manager = new BackupManager();
        expect(manager._normalizeHostname('www.Example.com')).toBe('example.com');
        expect(manager._normalizeHostname('example.com/path')).toBe('example.com');
    });

    it('backup export should continue traversing hidden icon cache and toolbar icon stores', async () => {
        const manager = new BackupManager();
        const exported = [];

        manager._exportIDBToZipStream = async (configKey, _zipper, basePath) => {
            exported.push({ configKey, basePath });
            return { entries: 0, totalSize: 0 };
        };
        manager._addFileToZip = () => {};

        global.chrome = {
            storage: {
                sync: { get: async () => ({ backgroundSettings: { type: 'color' } }) },
                local: { get: async () => ({ toolbarIconConfig: { enabled: true } }) }
            },
            runtime: {
                getManifest: () => ({ version: '3.0.0' })
            }
        };

        await manager._appendBackupDataToZipper({}, {}, 'compat-check');

        expect(exported).toEqual([
            { configKey: 'iconCache', basePath: 'idb/icon-cache' },
            { configKey: 'toolbarIcon', basePath: 'idb/toolbar-icon' },
            { configKey: 'assets', basePath: 'idb/assets' },
            { configKey: 'localFiles', basePath: 'idb/local-files' }
        ]);
    });
});
