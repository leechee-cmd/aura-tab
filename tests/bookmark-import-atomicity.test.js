import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 契约（specs/modules/bookmarks.md）：导入是整批一次提交——要么整批写进去，要么整批失败，
 * 不存在「写了一半」的中间状态，也不会把已经写成功的页再写一遍。
 */

const bulkAddItems = vi.hoisted(() => vi.fn());

vi.mock('../scripts/domains/quicklinks/store.js', () => ({
    store: {
        getAllItems: () => [],
        getPageCount: () => 1,
        getPage: () => [],
        bulkAddItems
    }
}));

vi.mock('../scripts/platform/i18n.js', () => ({
    t: (key) => key
}));

function pages(count) {
    return Array.from({ length: count }, (_, pageIndex) => ({
        name: `folder-${pageIndex}`,
        items: [
            { title: `a${pageIndex}`, url: `https://a${pageIndex}.example.com` },
            { title: `b${pageIndex}`, url: `https://b${pageIndex}.example.com` }
        ]
    }));
}

describe('bookmark import atomicity', () => {
    let importer;

    beforeEach(async () => {
        vi.resetModules();
        bulkAddItems.mockReset();
        const { bookmarkImporter } = await import('../scripts/domains/bookmarks/importer.js');
        importer = bookmarkImporter;
    });

    it('submits every page in a single write', async () => {
        bulkAddItems.mockResolvedValue({ status: 'success', success: 4, failed: 0 });

        const result = await importer.executeImport(pages(2), () => {});

        expect(bulkAddItems).toHaveBeenCalledTimes(1);
        expect(bulkAddItems.mock.calls[0][0]).toHaveLength(2);
        expect(result.status).toBe('success');
        expect(result.success).toBe(4);
    });

    it('reports total failure and writes nothing when the single write throws', async () => {
        bulkAddItems.mockRejectedValue(new Error('sync quota exceeded'));

        const result = await importer.executeImport(pages(3), () => {});

        expect(bulkAddItems).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('failed');
        expect(result.success).toBe(0);
        expect(result.failed).toBe(6);
        expect(result.errorMessage).toContain('sync quota exceeded');
    });

    it('does not retry the write after a failure', async () => {
        bulkAddItems.mockResolvedValue({ status: 'failed', success: 0, failed: 6, errorCode: 'SYNC_QUOTA_EXCEEDED' });

        const result = await importer.executeImport(pages(3), () => {});

        expect(bulkAddItems).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('failed');
        expect(result.errorCode).toBe('SYNC_QUOTA_EXCEEDED');
    });

    it('does not write at all when there is nothing to import', async () => {
        const result = await importer.executeImport([], () => {});

        expect(bulkAddItems).not.toHaveBeenCalled();
        expect(result.status).toBe('success');
        expect(result.success).toBe(0);
    });
});
