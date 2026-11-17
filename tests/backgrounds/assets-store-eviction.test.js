import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 契约（specs/modules/backgrounds.md、specs/modules/photos.md）：
 * 1. 收藏（用户固定）的图不参与容量淘汰，只有普通缓存才淘汰。
 * 2. 数据库不可用时进入降级模式，读取返回空值而不抛错，调用方据此降级。
 * 3. 关闭查看窗口要释放所有图片 URL。
 */

const state = vi.hoisted(() => ({ entries: [] }));

vi.mock('../../scripts/shared/storage.js', () => ({
    idbRequest: vi.fn(async (_db, _storeName, _mode, operation) => operation({
        get: () => undefined,
        put: () => undefined,
        delete: () => undefined
    })),
    idbBatch: vi.fn(async () => {}),
    idbCursorAll: vi.fn(async () => state.entries),
    idbCursorEach: vi.fn(async (_db, _storeName, callback) => {
        for (const entry of state.entries) callback(entry);
    })
}));

function entry(id, { pinned = false, size = 1024, accessedAt = 1 } = {}) {
    return {
        id,
        fullBlob: new Blob(['x']),
        fullSize: size,
        thumbnailBlob: null,
        isUserPinned: pinned,
        lastAccessedAt: accessedAt
    };
}

async function freshStore() {
    vi.resetModules();
    const { assetsStore } = await import('../../scripts/domains/backgrounds/assets-store.js');
    return assetsStore;
}

describe('assets store eviction', () => {
    beforeEach(() => {
        state.entries = [];
    });

    it('never evicts user-pinned images, even when they are the oldest', async () => {
        const assetsStore = await freshStore();
        vi.spyOn(assetsStore, 'getStats').mockResolvedValue({
            thumbnailCount: 0, thumbnailSize: 0,
            fullCount: 400, fullSize: 2 * 1024 * 1024 * 1024,
            pinnedCount: 3, invalidCount: 0
        });
        vi.spyOn(assetsStore, '_openDb').mockResolvedValue({});
        const deleted = [];
        vi.spyOn(assetsStore, 'deleteFullImage').mockImplementation(async (id) => {
            deleted.push(id);
        });

        // 固定的图排在最前面（最老），如果过滤失效它们会第一个被删
        state.entries = [
            entry('pinned-1', { pinned: true, accessedAt: 1 }),
            entry('pinned-2', { pinned: true, accessedAt: 2 }),
            entry('pinned-3', { pinned: true, accessedAt: 3 }),
            ...Array.from({ length: 30 }, (_, i) => entry(`cached-${i}`, { accessedAt: 10 + i }))
        ];

        await assetsStore._evictIfNeeded();

        expect(deleted.length).toBeGreaterThan(0);
        expect(deleted.filter((id) => id.startsWith('pinned'))).toEqual([]);
        expect(deleted[0]).toBe('cached-0');
    });

    it('does nothing while everything fits within the limits', async () => {
        const assetsStore = await freshStore();
        vi.spyOn(assetsStore, 'getStats').mockResolvedValue({
            thumbnailCount: 0, thumbnailSize: 0,
            fullCount: 10, fullSize: 10 * 1024,
            pinnedCount: 0, invalidCount: 0
        });
        const deleted = [];
        vi.spyOn(assetsStore, 'deleteFullImage').mockImplementation(async (id) => {
            deleted.push(id);
        });

        await assetsStore._evictIfNeeded();

        expect(deleted).toEqual([]);
    });
});

describe('assets store degraded mode', () => {
    beforeEach(() => {
        state.entries = [];
    });

    it('returns empty results instead of throwing once degraded', async () => {
        const assetsStore = await freshStore();
        assetsStore._consecutiveFailures = 3;
        expect(assetsStore.isDegraded()).toBe(true);

        await expect(assetsStore.getThumbnail('anything')).resolves.toBeNull();
        await expect(assetsStore.hasThumbnail('anything')).resolves.toBe(false);
        await expect(assetsStore.saveThumbnail('anything', new Blob(['x']))).resolves.toBe(false);
    });

    it('recovers once failures are cleared', async () => {
        const assetsStore = await freshStore();
        assetsStore._consecutiveFailures = 3;
        assetsStore._resetDegradedState();

        expect(assetsStore.isDegraded()).toBe(false);
    });
});

describe('assets store object urls', () => {
    let created = 0;

    beforeEach(() => {
        state.entries = [];
        created = 0;
        global.URL.createObjectURL = vi.fn(() => {
            created++;
            return `blob:mocked-${created}`;
        });
        global.URL.revokeObjectURL = vi.fn();
    });

    it('revokes every url when the viewer window closes', async () => {
        const assetsStore = await freshStore();
        assetsStore.createObjectUrl('a', new Blob(['a']));
        assetsStore.createObjectUrl('b', new Blob(['b']));

        assetsStore.releaseAllObjectUrls();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(assetsStore._objectUrls.size).toBe(0);
    });
});
