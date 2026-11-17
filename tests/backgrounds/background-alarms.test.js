import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMocks, setStorageData } from '../setup.js';

/**
 * 契约（specs/modules/service-worker.md）：
 * 1. 闹钟只在「在线来源 + 每小时/每天」时创建；本地文件、纯色、不轮换、每次开标签都不建。
 * 2. Bing 忽略用户频率，始终按天。
 * 3. 重算闹钟串行：不会出现两次创建之间没有先清掉的旧闹钟。
 */

const listeners = { onInstalled: null, onStartup: null, onAlarm: null };
const log = [];

function installChromeMocks() {
    chrome.runtime.getManifest = vi.fn(() => ({ version: '9.9.9' }));
    chrome.runtime.onInstalled = {
        addListener: vi.fn((cb) => { listeners.onInstalled = cb; })
    };
    chrome.runtime.onStartup = {
        addListener: vi.fn((cb) => { listeners.onStartup = cb; })
    };
    chrome.alarms = {
        clear: vi.fn(async () => {
            await Promise.resolve();
            log.push('clear');
            return true;
        }),
        create: vi.fn(async (_name, info) => {
            await Promise.resolve();
            log.push(`create:${info.periodInMinutes}`);
        }),
        onAlarm: {
            addListener: vi.fn((cb) => { listeners.onAlarm = cb; })
        }
    };
}

async function loadWorker() {
    vi.resetModules();
    await import('../../background-worker.js');
    return listeners;
}

async function triggerStartup() {
    await listeners.onStartup();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('background service worker alarms', () => {
    beforeEach(() => {
        resetMocks();
        log.length = 0;
        installChromeMocks();
    });

    it('creates an hourly alarm for an online source', async () => {
        setStorageData({ backgroundSettings: { type: 'unsplash', frequency: 'hour' } }, 'sync');
        await loadWorker();

        await triggerStartup();

        expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
        expect(chrome.alarms.create.mock.calls[0][0]).toBe('refreshBackground');
        expect(chrome.alarms.create.mock.calls[0][1].periodInMinutes).toBe(60);
    });

    it('creates a daily alarm for an online source', async () => {
        setStorageData({ backgroundSettings: { type: 'pexels', frequency: 'day' } }, 'sync');
        await loadWorker();

        await triggerStartup();

        expect(chrome.alarms.create.mock.calls[0][1].periodInMinutes).toBe(1440);
    });

    it('forces a daily alarm for bing even when the user picked never', async () => {
        setStorageData({ backgroundSettings: { type: 'bing', frequency: 'never' } }, 'sync');
        await loadWorker();

        await triggerStartup();

        expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
        expect(chrome.alarms.create.mock.calls[0][1].periodInMinutes).toBe(1440);
    });

    it.each([
        ['local files', { type: 'files', frequency: 'hour' }],
        ['solid color', { type: 'color', frequency: 'day' }],
        ['never', { type: 'unsplash', frequency: 'never' }],
        ['per tab', { type: 'unsplash', frequency: 'tabs' }]
    ])('does not create an alarm for %s', async (_label, backgroundSettings) => {
        setStorageData({ backgroundSettings }, 'sync');
        await loadWorker();

        await triggerStartup();

        expect(chrome.alarms.create).not.toHaveBeenCalled();
        expect(chrome.alarms.clear).toHaveBeenCalled();
    });

    it('rebuilds the alarm serially so two runs cannot leave two alarms', async () => {
        setStorageData({ backgroundSettings: { type: 'unsplash', frequency: 'hour' } }, 'sync');
        await loadWorker();

        await Promise.all([listeners.onStartup(), listeners.onStartup()]);
        await new Promise((resolve) => setTimeout(resolve, 10));

        const creates = log.filter((entry) => entry.startsWith('create'));
        expect(creates).toHaveLength(2);
        for (let i = 1; i < log.length; i++) {
            const pairOfCreates = log[i - 1].startsWith('create') && log[i].startsWith('create');
            expect(pairOfCreates).toBe(false);
        }
        expect(log[log.length - 1]).toBe('create:60');
    });
});
