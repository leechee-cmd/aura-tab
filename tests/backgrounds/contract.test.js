/**
 * The background worker's policy and safety contracts: what a refresh is allowed to do, how
 * `loadSettings` survives missing or hostile stored values, and that `destroy()` waits for
 * in-flight work and disconnects its runtime hooks.
 *
 * None of the three fakes a module, so this is a plain concatenation.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/backgrounds/background-policy.test.js
 *   tests/backgrounds/background-load-settings-safety.test.js
 *   tests/backgrounds/background-destroy-runtime-teardown.test.js
 */
import { describe, expect, it, vi } from 'vitest';
import { getStorageData, setStorageData } from '../setup.js';
import {
    getApplyOptions,
    getPrepareTimeoutMs,
    isOnlineBackgroundType,
    resolveRenderMode,
    shouldPreloadNextBackground
} from '../../scripts/domains/backgrounds/controller-actions.js';
import { DEFAULT_SETTINGS } from '../../scripts/domains/backgrounds/types.js';

// ===== from tests/backgrounds/background-policy.test.js =====
describe('background policy', () => {
    it('should detect online source types', () => {
        expect(isOnlineBackgroundType('unsplash')).toBe(true);
        expect(isOnlineBackgroundType('pixabay')).toBe(true);
        expect(isOnlineBackgroundType('pexels')).toBe(true);
        expect(isOnlineBackgroundType('bing')).toBe(true);
        expect(isOnlineBackgroundType('files')).toBe(false);
    });

    it('should increase prepare timeout for online source when smart crop is enabled', () => {
        const settings = { type: 'unsplash', smartCropEnabled: true };
        expect(getPrepareTimeoutMs(settings, 140, 'unsplash')).toBe(360);
        expect(getPrepareTimeoutMs(settings, 700, 'unsplash')).toBe(700);
    });

    it('should keep timeout unchanged when smart crop is disabled or source is local', () => {
        expect(getPrepareTimeoutMs({ type: 'unsplash', smartCropEnabled: false }, 140, 'unsplash')).toBe(140);
        expect(getPrepareTimeoutMs({ type: 'files', smartCropEnabled: true }, 140, 'files')).toBe(140);
    });

    it('should resolve render mode and apply options consistently', () => {
        expect(resolveRenderMode({ type: 'unsplash', smartCropEnabled: true }, 'unsplash')).toBe('single-stage');
        expect(resolveRenderMode({ type: 'files', smartCropEnabled: true }, 'files')).toBe('progressive');
        expect(getApplyOptions({ type: 'unsplash', smartCropEnabled: true }, 'unsplash')).toEqual({
            renderMode: 'single-stage'
        });
    });

    it('should disable preload only for tabs frequency on online sources', () => {
        expect(shouldPreloadNextBackground({ type: 'unsplash', frequency: 'tabs' }, 'unsplash')).toBe(false);
        expect(shouldPreloadNextBackground({ type: 'pixabay', frequency: 'tabs' }, 'pixabay')).toBe(false);
        expect(shouldPreloadNextBackground({ type: 'bing', frequency: 'tabs' }, 'bing')).toBe(false);
        expect(shouldPreloadNextBackground({ type: 'files', frequency: 'tabs' }, 'files')).toBe(true);
        expect(shouldPreloadNextBackground({ type: 'unsplash', frequency: 'hour' }, 'unsplash')).toBe(true);
    });
});

// ===== from tests/backgrounds/background-load-settings-safety.test.js =====
async function freshBackgroundSystem() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/backgrounds/controller.js');
    return mod.backgroundSystem;
}

describe('Background loadSettings safety', () => {
    it('should persist defaults only when key is truly missing', async () => {
        setStorageData({}, 'sync');

        const backgroundSystem = await freshBackgroundSystem();
        await backgroundSystem.loadSettings();

        const persisted = getStorageData('sync');
        expect(persisted.backgroundSettings).toBeTruthy();
        expect(persisted.backgroundSettings.type).toBe(DEFAULT_SETTINGS.type);

        backgroundSystem.destroy();
    });

    it('should not overwrite existing settings when sync read fails', async () => {
        const existing = {
            type: 'color',
            color: '#112233',
            texture: { type: 'none' },
            apiKeys: {}
        };
        setStorageData({ backgroundSettings: existing }, 'sync');

        const backgroundSystem = await freshBackgroundSystem();
        const originalGet = chrome.storage.sync.get.getMockImplementation();
        const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async (keys) => {
            if (keys === 'backgroundSettings') {
                throw new Error('temporary sync read failure');
            }
            return originalGet(keys);
        });
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await backgroundSystem.loadSettings();

        const persisted = getStorageData('sync');
        expect(persisted.backgroundSettings).toEqual(existing);
        expect(setSpy).not.toHaveBeenCalled();
        expect(backgroundSystem.settings.type).toBe(DEFAULT_SETTINGS.type);

        getSpy.mockRestore();
        setSpy.mockRestore();
        backgroundSystem.destroy();
    });

    it('persists the latest background when state saves happen back to back', async () => {
        const backgroundSystem = await freshBackgroundSystem();
        chrome.storage.local.set.mockClear();

        await backgroundSystem._saveBackgroundState({
            id: 'first',
            format: 'image',
            urls: { full: 'https://example.com/first.jpg' },
            color: '#111111'
        });
        await backgroundSystem._saveBackgroundState({
            id: 'latest',
            format: 'image',
            urls: { full: 'https://example.com/latest.jpg' },
            color: '#222222'
        });

        expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
        const latestWrite = chrome.storage.local.set.mock.calls.at(-1)[0];
        expect(latestWrite.currentBackground.id).toBe('latest');

        backgroundSystem.destroy();
    });

    it('ignores a stale hydrated background after a newer storage change', async () => {
        const backgroundSystem = await freshBackgroundSystem();
        backgroundSystem.settings = { ...backgroundSystem.settings, type: 'files' };
        let resolveFirstHydration;
        vi.spyOn(backgroundSystem, '_hydrateStoredBackground').mockImplementation((stored) => {
            if (stored.id === 'first') {
                return new Promise((resolve) => {
                    resolveFirstHydration = resolve;
                });
            }
            return Promise.resolve(stored);
        });
        const applySpy = vi.spyOn(backgroundSystem, '_applyBackgroundInternal').mockResolvedValue();

        const firstChange = backgroundSystem._handleLocalStorageChange({
            currentBackground: { newValue: { id: 'first', urls: { full: 'blob:first' } } }
        });
        const latestChange = backgroundSystem._handleLocalStorageChange({
            currentBackground: { newValue: { id: 'latest', urls: { full: 'blob:latest' } } }
        });
        await latestChange;
        resolveFirstHydration({ id: 'first', urls: { full: 'blob:first' } });
        await firstChange;

        expect(backgroundSystem.currentBackground.id).toBe('latest');
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(applySpy.mock.calls[0][0].id).toBe('latest');

        backgroundSystem.destroy();
    });
});

// ===== from tests/backgrounds/background-destroy-runtime-teardown.test.js =====
describe('BackgroundSystem destroy runtime teardown safety', () => {
    it('should not throw when runtime disappears before unload cleanup runs', async () => {
        vi.resetModules();

        const { backgroundSystem } = await import('../../scripts/domains/backgrounds/controller.js');

        backgroundSystem._runtimeMessageHandler = vi.fn();
        const originalRuntime = chrome.runtime;

        chrome.runtime = undefined;

        expect(() => backgroundSystem.destroy()).not.toThrow();
        expect(backgroundSystem._runtimeMessageHandler).toBeNull();

        chrome.runtime = originalRuntime;
    });
});
