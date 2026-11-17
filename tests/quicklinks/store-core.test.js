/**
 * The quick-link store's pure layer: entry normalization, the defensive branches, search
 * matching and its case table, tags, page-size hints, magnify scale and grid density
 * settings.
 *
 * Four of these files had each declared its own `seedItems` and seven had their own
 * `freshStore`, with slightly different bodies — a `seedItems(items)` that fills in defaults
 * and a `seedItems(count)` that generates ids are not interchangeable. They were renamed per
 * section instead of collapsed, so every case still seeds exactly what it did before.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/quicklinks/store-entries.test.js
 *   tests/quicklinks/store-lowlevel-branches.test.js
 *   tests/quicklinks/store_search.test.js
 *   tests/quicklinks/store_search_cases.test.js
 *   tests/quicklinks/store_tags.test.js
 *   tests/quicklinks/store-pagination-hint.test.js
 *   tests/quicklinks/store-magnify-scale.test.js
 *   tests/quicklinks/store-grid-density.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorageData, setStorageData, triggerStorageChange } from '../setup.js';
import {
    dedupeStoreEntries,
    isConcreteStoreEntry,
    normalizeStoreEntries,
    normalizeStoreStructure
} from '../../scripts/domains/quicklinks/store.js';

// ===== from tests/quicklinks/store-entries.test.js =====
describe('store-entries helpers', () => {
    it('normalizeStoreEntries should keep valid ids, system ids and page breaks', () => {
        const result = normalizeStoreEntries(
            ['qlink_a', '__PAGE_BREAK__', '__SYSTEM_SETTINGS__', null, 'bad'],
            {
                pageBreak: '__PAGE_BREAK__',
                linkPrefix: 'qlink_',
                isSystemItemId: (id) => id.startsWith('__SYSTEM_')
            }
        );

        expect(result).toEqual(['qlink_a', '__PAGE_BREAK__', '__SYSTEM_SETTINGS__']);
    });

    it('normalizeStoreStructure should strip leading/trailing and duplicated page breaks', () => {
        const result = normalizeStoreStructure(
            ['__PAGE_BREAK__', 'a', '__PAGE_BREAK__', '__PAGE_BREAK__', 'b', '__PAGE_BREAK__'],
            '__PAGE_BREAK__'
        );

        expect(result).toEqual(['a', '__PAGE_BREAK__', 'b']);
    });

    it('dedupeStoreEntries should dedupe concrete ids while preserving breaks', () => {
        const result = dedupeStoreEntries(
            ['a', '__PAGE_BREAK__', 'a', 'b', '__PAGE_BREAK__', 'b'],
            '__PAGE_BREAK__'
        );

        expect(result).toEqual(['a', '__PAGE_BREAK__', 'b', '__PAGE_BREAK__']);
    });

    it('isConcreteStoreEntry should exclude page break', () => {
        expect(isConcreteStoreEntry('a', '__PAGE_BREAK__')).toBe(true);
        expect(isConcreteStoreEntry('__PAGE_BREAK__', '__PAGE_BREAK__')).toBe(false);
    });
});

// ===== from tests/quicklinks/store-lowlevel-branches.test.js =====
/**
 * Store low-level branch coverage tests
 *
 * These focus on a few defensive branches that are meaningful in production:
 * - Web Locks failure fallback
 * - storage revision generation fallback (no crypto.randomUUID)
 * - grid density clamp on non-finite inputs
 * - destroyed-instance guard
 */


async function freshLowlevelStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

describe('Store low-level defensive branches', () => {
    /** @type {any} */
    let originalLocks;
    /** @type {any} */
    let originalRandomUUID;

    beforeEach(() => {
        originalLocks = globalThis.navigator?.locks;
        originalRandomUUID = globalThis.crypto?.randomUUID;
    });

    afterEach(() => {
        if (globalThis.navigator) {
            globalThis.navigator.locks = originalLocks;
        }
        if (globalThis.crypto) {
            globalThis.crypto.randomUUID = originalRandomUUID;
        }
    });

    it('should fall back when Web Locks request throws', async () => {
        // Make Web Locks exist but fail.
        globalThis.navigator.locks = {
            request: vi.fn(async () => {
                throw new Error('locks unavailable');
            })
        };

        const store = await freshLowlevelStore();
        await store.init();

        const item = await store.addItem({ title: 'Lock fallback', url: 'https://lock.example.com' });

        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems).toContain(item._id);

        store.destroy?.();
    });

    it('should rethrow task error instead of masking it as Web Locks unavailable', async () => {
        globalThis.navigator.locks = {
            request: vi.fn(async (name, options, callback) => callback())
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = await freshLowlevelStore();
        await store.init();

        await expect(
            store._withCrossTabLock(async () => {
                throw new Error('task failed');
            })
        ).rejects.toThrow('task failed');

        expect(
            warnSpy.mock.calls.some(([msg]) => String(msg).includes('Web Locks unavailable'))
        ).toBe(false);

        warnSpy.mockRestore();
        store.destroy?.();
    });

    it('should generate a storage revision without crypto.randomUUID', async () => {
        // Remove randomUUID so Store uses the Date.now/Math.random fallback.
        globalThis.crypto.randomUUID = undefined;
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const store = await freshLowlevelStore();
        await store.init();

        // _generateStorageRevision() is used by _commit(); use a write path that
        // goes through _commit to cover the fallback branch.
        await store.addItem({
            _id: 'qlink_test_revision_fallback',
            title: 'Test',
            url: 'https://example.com'
        });

        const persisted = getStorageData('sync');
        expect(typeof persisted.quicklinksRevision).toBe('string');
        expect(persisted.quicklinksRevision).toContain('1700000000000_');

        randSpy.mockRestore();
        nowSpy.mockRestore();
        store.destroy?.();
    });

    it('should clamp grid density when given non-finite values', async () => {
        const store = await freshLowlevelStore();
        await store.init();

        triggerStorageChange({
            launchpadGridColumns: { newValue: NaN },
            launchpadGridRows: { newValue: Infinity }
        }, 'sync');

        expect(store.settings.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.DEFAULT_COLS);
        expect(store.settings.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.DEFAULT_ROWS);

        store.destroy?.();
    });

    it('should throw a clear error when used after destroy', async () => {
        const store = await freshLowlevelStore();
        await store.init();
        store.destroy?.();

        expect(() => store.subscribe(() => {})).toThrow('[Store] Instance has been destroyed');
    });

    it('should rethrow listener errors instead of swallowing them', async () => {
        const store = await freshLowlevelStore();
        await store.init();

        store.subscribe(() => {
            throw new Error('listener failed');
        });

        expect(() => store._notify('test:event')).toThrow('listener failed');

        store.destroy?.();
    });

    it('should not reinitialize schema when quicklinks read fails', async () => {
        setStorageData({
            quicklinksItems: ['qlink_keep'],
            quicklinksDockPins: ['qlink_keep'],
            quicklinksChunkSet_seed_index: [],
            quicklinksActiveSet: 'seed'
        }, 'sync');

        const store = await freshLowlevelStore();
        const originalGet = chrome.storage.sync.get.getMockImplementation();
        const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.length === 2 && keys.includes('quicklinksItems') && keys.includes('quicklinksDockPins')) {
                throw new Error('temporary sync read failure');
            }
            return originalGet(keys);
        });
        const setSpy = vi.spyOn(chrome.storage.sync, 'set');

        await store.loadData();

        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems).toEqual(['qlink_keep']);
        expect(setSpy).not.toHaveBeenCalled();

        getSpy.mockRestore();
        setSpy.mockRestore();
        store.destroy?.();
    });
});

// ===== from tests/quicklinks/store_search.test.js =====
/**
 * Store search tests
 *
 * Focus:
 * - 按空格分词：每个词都要命中（AND）
 * - URL 归一：https://、www.、末尾斜杠不参与匹配
 * - 打分：标题前缀 > 标题子串 > 标签 > 域名 > 路径
 * - 文件夹只按标题匹配
 */


async function freshSearchStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedSearchItems(items) {
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (const item of items) {
        data.quicklinksItems.push(item._id);
        chunk[item._id] = {
            _id: item._id,
            title: item.title,
            url: item.url,
            icon: item.icon ?? '',
            tags: item.tags ?? [],
            createdAt: item.createdAt ?? Date.now(),
            ...(item.type === 'folder' ? { type: 'folder', children: item.children ?? [] } : {})
        };
    }

    data.quicklinksActiveSet = 'seed_search';
    data.quicklinksChunkSet_seed_search_index = items.length > 0 ? ['quicklinksChunkSet_seed_search_0'] : [];
    if (items.length > 0) {
        data.quicklinksChunkSet_seed_search_0 = chunk;
    }

    setStorageData(data, 'sync');
}

async function searchIn(items, query, options) {
    seedSearchItems(items);

    const store = await freshSearchStore();
    await store.init();
    const ids = store.search(query, options).map((item) => item._id);
    store.destroy?.();
    return ids;
}

const LINKS = [
    { _id: 'qlink_gh', title: 'GitHub', url: 'https://github.com/leech' },
    { _id: 'qlink_gl', title: 'GitLab', url: 'https://gitlab.com' },
    { _id: 'qlink_gitea', title: '自建 Gitea', url: 'https://www.git.mine.dev' },
    { _id: 'qlink_docs', title: '团队文档', url: 'https://docs.example.com/git/flow' }
];

describe('store.search matching', () => {
    it('needs every word, not the query as one string', async () => {
        // The old matcher compared the whole query as one substring, so this found nothing.
        expect(await searchIn(LINKS, 'git hub')).toEqual(['qlink_gh']);
    });

    it('matches words spread across title, tags and url', async () => {
        const items = [
            { _id: 'qlink_a', title: 'Aura', url: 'https://github.com/leech/aura', tags: ['tab'] }
        ];
        expect(await searchIn(items, 'aura github')).toEqual(['qlink_a']);
        expect(await searchIn(items, 'aura tab')).toEqual(['qlink_a']);
    });

    it('ignores the scheme, a leading www. and a trailing slash', async () => {
        expect(await searchIn(LINKS, 'www')).toEqual([]);
        expect(await searchIn(LINKS, 'https')).toEqual([]);
        expect(await searchIn(LINKS, 'git.mine.dev')).toEqual(['qlink_gitea']);
        expect(await searchIn(LINKS, 'gitlab.com')).toEqual(['qlink_gl']);
    });

    it('ranks a title prefix above a title match, tags, host and path', async () => {
        const items = [
            { _id: 'qlink_path', title: 'Zeta', url: 'https://example.com/deep/page' },
            { _id: 'qlink_host', title: 'Yankee', url: 'https://deep.example.com' },
            { _id: 'qlink_tag', title: 'Xray', url: 'https://x.example', tags: ['deep'] },
            { _id: 'qlink_inside', title: 'A deep thing', url: 'https://a.example' },
            { _id: 'qlink_prefix', title: 'Deep work', url: 'https://b.example' }
        ];

        expect(await searchIn(items, 'deep')).toEqual(['qlink_prefix', 'qlink_inside', 'qlink_tag', 'qlink_host', 'qlink_path']);
    });

    it('adds the words up, so the item that answers both in the title wins', async () => {
        const items = [
            // git in the title, notes only in the host
            { _id: 'qlink_weak', title: 'Git', url: 'https://notes.example' },
            // both words in the title
            { _id: 'qlink_strong', title: 'Git notes', url: 'https://x.example' }
        ];
        expect(await searchIn(items, 'git notes')).toEqual(['qlink_strong', 'qlink_weak']);
    });

    it('still matches folders by title, and nothing else about them', async () => {
        const items = [
            { _id: 'qfolder_1', type: 'folder', title: 'Deep 学习资料' },
            { _id: 'qlink_1', title: 'Other', url: 'https://deep.example.com' }
        ];
        expect(await searchIn(items, 'deep')).toEqual(['qfolder_1', 'qlink_1']);
    });

    it('keeps #tag as an exact tag lookup', async () => {
        const items = [
            { _id: 'qlink_a', title: 'A', url: 'https://a.example', tags: ['Work'] },
            { _id: 'qlink_b', title: 'Work thing', url: 'https://b.example' }
        ];
        expect(await searchIn(items, '#work')).toEqual(['qlink_a']);
    });

    it('honours the limit after ranking, not before', async () => {
        const items = [
            { _id: 'qlink_low', title: 'Zeta', url: 'https://example.com/deep' },
            { _id: 'qlink_high', title: 'Deep thing', url: 'https://a.example' }
        ];
        expect(await searchIn(items, 'deep', { limit: 1 })).toEqual(['qlink_high']);
    });
});

// ===== from tests/quicklinks/store_search_cases.test.js =====
/**
 * 链接搜索的用例表
 *
 * 跑一份固定的语料，然后按「用户会怎么搜」逐条问：名字、网址、标签、多个词、
 * 中文、大小写、端口、路径、符号。这一组不追求实现细节，只描述期望结果。
 */


async function freshSearchCasesStore() {
    vi.resetModules();
    return (await import('../../scripts/domains/quicklinks/store.js')).store;
}

const CORPUS = [
    { _id: 'qlink_gh', title: 'GitHub', url: 'https://github.com/leech/aura-tab' },
    { _id: 'qlink_gl', title: 'GitLab', url: 'https://gitlab.com' },
    { _id: 'qlink_gitea', title: '自建 Gitea', url: 'https://git.mine.dev' },
    { _id: 'qlink_docs', title: '团队文档', url: 'https://docs.example.com/git/flow', tags: ['文档'] },
    { _id: 'qlink_notes', title: 'Work notes', url: 'https://notes.example.com', tags: ['work'] },
    { _id: 'qlink_zhihu', title: '知乎', url: 'https://www.zhihu.com' },
    { _id: 'qlink_local', title: '本地服务', url: 'http://localhost:8080/admin' },
    { _id: 'qlink_icons', title: '图标集', url: 'https://icons.example.com/set?q=a.b' },
    { _id: 'qfolder_git', type: 'folder', title: 'Git 资料' }
];

async function seedCorpus() {
    const chunk = {};
    const ids = [];
    for (const item of CORPUS) {
        ids.push(item._id);
        chunk[item._id] = {
            _id: item._id,
            title: item.title,
            url: item.url ?? '',
            icon: '',
            tags: item.tags ?? [],
            createdAt: 1,
            ...(item.type === 'folder' ? { type: 'folder', children: [] } : {})
        };
    }
    setStorageData({
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: ids,
        quicklinksActiveSet: 'corpus',
        quicklinksChunkSet_corpus_index: ['quicklinksChunkSet_corpus_0'],
        quicklinksChunkSet_corpus_0: chunk
    }, 'sync');

    const store = await freshSearchCasesStore();
    await store.init();
    return store;
}

// 每条：搜什么，必须出现谁，必须不出现谁
const CASES = [
    // 名字
    ['按名字搜全称', 'GitHub', ['qlink_gh'], ['qlink_gl']],
    ['名字大小写无所谓', 'github', ['qlink_gh'], []],
    ['名字前缀', 'gitl', ['qlink_gl'], []],
    ['名字中间一段', 'itla', ['qlink_gl'], []],
    ['中文名字整词', '知乎', ['qlink_zhihu'], []],
    ['中文名字半截', '团队', ['qlink_docs'], []],
    ['大小写混排的英文名字', 'WORK NOTES', ['qlink_notes'], []],

    // 网址
    ['按域名搜', 'gitlab.com', ['qlink_gl'], []],
    ['域名带子域', 'mine.dev', ['qlink_gitea'], []],
    ['按路径搜', 'flow', ['qlink_docs'], []],
    ['按路径里的一段搜', 'cheatsheet', [], []],
    ['域名中间一段', 'zhihu', ['qlink_zhihu'], []],
    ['带 www 的地址不用打 www', 'zhihu.com', ['qlink_zhihu'], []],
    ['协议名不该参与匹配', 'https', [], ['qlink_gh', 'qlink_gl']],
    ['www 也不该参与匹配', 'www', [], ['qlink_zhihu']],
    ['端口号', '8080', ['qlink_local'], []],
    ['localhost', 'localhost', ['qlink_local'], []],
    ['零散字符不跨符号匹配', 'q.a', [], ['qlink_icons']],
    ['查询串也能原样搜', 'q=a.b', ['qlink_icons'], []],
    ['星号不是通配符', 'qua*', [], ['qlink_icons']],

    // 标签
    ['按标签搜', 'work', ['qlink_notes'], []],
    ['中文标签', '文档', ['qlink_docs'], []],

    // 多个词
    ['两个词分别落在名字和域名上', 'git hub', ['qlink_gh'], ['qlink_gl']],
    ['两个词落在名字和路径上', '团队 flow', ['qlink_docs'], []],
    ['两个词落在标签和名字上', 'work notes', ['qlink_notes'], []],
    ['词序无关', 'hub git', ['qlink_gh'], ['qlink_gl']],
    ['有一个词落空就整条不要', 'git 不存在的词', [], ['qlink_gh', 'qlink_gl']],
    ['多余的空格不影响', '  git   hub  ', ['qlink_gh'], []],
    ['换行也当分隔', 'git\nhub', ['qlink_gh'], []],

    // 文件夹
    ['文件夹按名字命中', '资料', ['qfolder_git'], []]
];

describe('链接搜索用例表', () => {
    it('跑完所有用例', async () => {
        const store = await seedCorpus();
        const failures = [];

        for (const [label, query, must, mustNot] of CASES) {
            const ids = store.search(query).map((item) => item._id);
            const missing = must.filter((id) => !ids.includes(id));
            const extra = mustNot.filter((id) => ids.includes(id));
            if (missing.length || extra.length) {
                failures.push(`${label}（搜「${query}」）→ ${JSON.stringify(ids)} 缺 ${JSON.stringify(missing)} 多 ${JSON.stringify(extra)}`);
            }
        }

        store.destroy?.();
        expect(failures).toEqual([]);
    });

    it('搜不到时给空数组，不是 undefined 也不是全部', async () => {
        const store = await seedCorpus();
        expect(store.search('绝对没有这个')).toEqual([]);
        store.destroy?.();
    });

    it('空输入、纯空格、只有 # 都不会把整个库倒出来', async () => {
        const store = await seedCorpus();
        for (const query of ['', '   ', '\n', null, undefined, 0]) {
            expect(store.search(query)).toEqual([]);
        }
        store.destroy?.();
    });

    it('limit 只截排名靠后的，不会先截再排', async () => {
        const store = await seedCorpus();
        const all = store.search('git').map((item) => item._id);
        const top = store.search('git', { limit: 2 }).map((item) => item._id);
        expect(top).toEqual(all.slice(0, 2));
        store.destroy?.();
    });

    it('同一条链接在结果里只出现一次', async () => {
        const store = await seedCorpus();
        // "git" 同时命中 GitHub 的名字和域名，命中两次不能变成两行
        const ids = store.search('git').map((item) => item._id);
        expect(ids.filter((id) => id === 'qlink_gh')).toHaveLength(1);
        store.destroy?.();
    });

    it('结果里的条目原样返回，不夹带分数或包装对象', async () => {
        const store = await seedCorpus();
        const [first] = store.search('github');
        expect(first).toMatchObject({ _id: 'qlink_gh', title: 'GitHub' });
        expect(first.score).toBeUndefined();
        store.destroy?.();
    });
});

// ===== from tests/quicklinks/store_tags.test.js =====
/**
 * Store tags tests
 *
 * Focus:
 * - init loads + normalizes quicklinksTags (trim/length/dedupe/limit)
 * - storage onChanged updates tags and emits tagsChanged
 * - search supports #tag exact and free-text tag matches ordering
 */


async function freshTagsStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedTagItems(items) {
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (const item of items) {
        data.quicklinksItems.push(item._id);
        chunk[item._id] = {
            _id: item._id,
            title: item.title,
            url: item.url,
            icon: item.icon ?? '',
            tags: item.tags,
            createdAt: item.createdAt ?? Date.now()
        };
    }

    data.quicklinksActiveSet = 'seed_tags';
    data.quicklinksChunkSet_seed_tags_index = items.length > 0 ? ['quicklinksChunkSet_seed_tags_0'] : [];
    if (items.length > 0) {
        data.quicklinksChunkSet_seed_tags_0 = chunk;
    }

    setStorageData(data, 'sync');
}

describe('Store tags', () => {
    it('init should load and normalize tag library', async () => {
        seedTagItems([
            { _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: ['Work'] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['  Work  ', 'work', 'VeryLongTagName', '', null, 'Personal']
        }, 'sync');

        const store = await freshTagsStore();
        await store.init();

        expect(store.getTags().slice().sort()).toEqual(['VeryLongTa', 'Work', 'Personal'].slice().sort());
        store.destroy?.();
    });

    it('storage onChanged should normalize quicklinksTags and emit tagsChanged', async () => {
        seedTagItems([{ _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: [] }]);
        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: []
        }, 'sync');

        const store = await freshTagsStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksTags: {
                oldValue: [],
                newValue: [' Foo ', 'foo', 'Bar', 'VeryLongTagName']
            }
        }, 'sync');

        expect(store.getTags()).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        const last = events.filter(e => e.event === 'tagsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        // defensive copy
        last.data.push('Mutate');
        expect(store.getTags()).toEqual(['Bar', 'Foo', 'VeryLongTa']);

        store.destroy?.();
    });

    it('search should support #tag exact match (case-insensitive)', async () => {
        seedTagItems([
            { _id: 'qlink_001', title: 'A', url: 'https://a.example', tags: ['Work'] },
            { _id: 'qlink_002', title: 'B', url: 'https://b.example', tags: ['Personal'] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['Work', 'Personal']
        }, 'sync');

        const store = await freshTagsStore();
        await store.init();

        const results = store.search('#work');
        expect(results.map(r => r._id)).toEqual(['qlink_001']);

        store.destroy?.();
    });

    it('search should rank title matches before tag matches before url matches', async () => {
        seedTagItems([
            { _id: 'qlink_001', title: 'Alpha title', url: 'https://x.example', tags: [] },
            { _id: 'qlink_002', title: 'Nope', url: 'https://y.example', tags: ['alpha'] },
            { _id: 'qlink_003', title: 'Nope', url: 'https://alpha.example', tags: [] }
        ]);

        setStorageData({
            ...getStorageData('sync'),
            quicklinksTags: ['alpha']
        }, 'sync');

        const store = await freshTagsStore();
        await store.init();

        const results = store.search('alpha');
        expect(results.map(r => r._id)).toEqual(['qlink_001', 'qlink_002', 'qlink_003']);

        store.destroy?.();
    });
});

// ===== from tests/quicklinks/store-pagination-hint.test.js =====
/**
 * Store pagination consistency tests
 *
 * Covers bug:
 * - When Launchpad grid capacity > Store default (24), dragging all items to page 1
 *   could still re-split into page 2 after reopen due to Store using fixed default.
 *
 * Fix relies on:
 * - Store.setPageSizeHint(pageSize)
 * - Store.reorderFromDom persisting PAGE_BREAK structure and dropping trailing ghost pages
 */


async function freshPagedStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedPagedItems(count) {
    const ids = [];
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (let i = 0; i < count; i++) {
        const id = `qlink_${String(i).padStart(3, '0')}`;
        ids.push(id);
        chunk[id] = {
            _id: id,
            title: `Item ${i}`,
            url: `https://example.com/${i}`,
            icon: '',
            createdAt: Date.now() - i
        };
    }

    data.quicklinksItems = ids;
    data.quicklinksActiveSet = 'seed_pagination_hint';
    data.quicklinksChunkSet_seed_pagination_hint_index = ids.length > 0 ? ['quicklinksChunkSet_seed_pagination_hint_0'] : [];
    if (ids.length > 0) {
        data.quicklinksChunkSet_seed_pagination_hint_0 = chunk;
    }
    setStorageData(data, 'sync');

    return ids;
}

describe('Store pageSizeHint + reorderFromDom', () => {
    const SETTINGS_ID = '__SYSTEM_SETTINGS__';
    const PHOTOS_ID = '__SYSTEM_PHOTOS__';

    it('should use pageSizeHint to avoid incorrect re-pagination', async () => {
        const ids = seedPagedItems(30);

        const store = await freshPagedStore();
        await store.init();

        // Default is 24 => splits into 2 pages (30 > 24)
        expect(store.getPageCount()).toBe(2);
        expect(store.getPage(0).length).toBe(24);
        expect(store.getPage(1).length).toBe(8);  // 30 + 2 system items - 24 = 8

        // Simulate Launchpad grid capacity 36
        store.setPageSizeHint(36);
        expect(store.getPageCount()).toBe(1);
        expect(store.getPage(0).length).toBe(32);  // 30 + 2 system items

        // Simulate DOM after user dragged everything into page 1
        // (and there is an empty trailing ghost page)
        await store.reorderFromDom([[PHOTOS_ID, SETTINGS_ID, ...ids], []], { silent: true });

        // Should not persist a trailing PAGE_BREAK / empty page
        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems).toEqual([PHOTOS_ID, SETTINGS_ID, ...ids]);

        // With correct hint, should remain one page
        expect(store.getPageCount()).toBe(1);
        expect(store.getPage(0).map(x => x._id)).toEqual([PHOTOS_ID, SETTINGS_ID, ...ids]);
    });

    it('addItem(pageIndex) should append into that page (not global tail)', async () => {
        const ids = seedPagedItems(8);

        // Build an explicit 3-page structure where page 0 has space and is not the last page.
        // Page 0: 4 items, Page 1: 2 items, Page 2: 2 items
        const base = getStorageData('sync');
        setStorageData({
            ...base,
            quicklinksItems: [
                ids[0], ids[1], ids[2], ids[3],
                '__PAGE_BREAK__',
                ids[4], ids[5],
                '__PAGE_BREAK__',
                ids[6], ids[7]
            ]
        }, 'sync');

        const store = await freshPagedStore();
        await store.init();

        expect(store.getPageCount()).toBe(3);
        expect(store.getPage(0).length).toBe(6);  // 4 + 2 system items
        expect(store.getPage(2).length).toBe(2);

        // Add item into page 0, at end of that page
        const created = await store.addItem({
            title: 'New',
            url: 'https://example.com/new',
            icon: ''
        }, 0);

        // Should land on page 0 (not the global tail / last page)
        const page0Ids = store.getPage(0).map(x => x._id);
        const lastPageIds = store.getPage(store.getPageCount() - 1).map(x => x._id);
        expect(page0Ids).toContain(created._id);
        expect(lastPageIds).not.toContain(created._id);
    });

    it('bulkAddItems should create page breaks and avoid trailing empty page', async () => {
        seedPagedItems(3);
        const store = await freshPagedStore();
        await store.init();

        // Import 2 pages worth of items
        const result = await store.bulkAddItems([
            { pageIndex: 1, items: [{ title: 'A', url: 'https://a.example', icon: '' }] },
            { pageIndex: 2, items: [{ title: 'B', url: 'https://b.example', icon: '' }] }
        ]);

        expect(result.success).toBe(2);

        const persisted = getStorageData('sync');
        const items = persisted.quicklinksItems;
        expect(Array.isArray(items)).toBe(true);
        expect(items[items.length - 1]).not.toBe('__PAGE_BREAK__');
        expect(items.includes('__PAGE_BREAK__')).toBe(true);
    });

    it('removePage should remove ghost trailing page without persisting', async () => {
        seedPagedItems(2);
        const store = await freshPagedStore();
        await store.init();

        // Create a ghost page (in-memory only)
        const ghostIndex = store.addPage();
        expect(store.getPageCount()).toBe(2);
        expect(store.getPage(ghostIndex).length).toBe(0);

        // Remove ghost page: should succeed and must NOT touch storage
        const ok = await store.removePage(ghostIndex, { silent: true });
        expect(ok).toBe(true);
        expect(store.getPageCount()).toBe(1);

        const persisted = getStorageData('sync');
        // No PAGE_BREAK should be written just because of ghost page lifecycle
        expect(persisted.quicklinksItems).toEqual(expect.not.arrayContaining(['__PAGE_BREAK__']));
    });

    it('removePage should not remove implicit (capacity-based) pages', async () => {
        // 30 items => implicit second page under default 24 capacity (no PAGE_BREAK)
        seedPagedItems(30);
        const store = await freshPagedStore();
        await store.init();

        expect(store.getPageCount()).toBe(2);
        const ok = await store.removePage(1, { silent: true });
        expect(ok).toBe(false);

        // Storage should remain without explicit breaks
        const persisted = getStorageData('sync');
        expect(persisted.quicklinksItems.includes('__PAGE_BREAK__')).toBe(false);
    });
});

// ===== from tests/quicklinks/store-magnify-scale.test.js =====
/**
 * Store magnify scale (Dock) settings tests
 *
 * Root-cause coverage:
 * - storage onChanged must propagate quicklinksMagnifyScale into store.settings.magnifyScale
 * - must emit settingsChanged so Dock can re-apply runtime behavior (e.g. magnify-off)
 */


async function freshMagnifyStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedMinimalV4() {
    setStorageData({
        storageVersion: 4,
        quicklinksDockPins: [],
        quicklinksItems: []
    }, 'sync');
}

describe('Store magnify scale settings', () => {
    it('rests at 20 for a fresh install, so the dock does not burst open by default', async () => {
        seedMinimalV4();
        const store = await freshMagnifyStore();
        await store.init();
        expect(store.settings.magnifyScale).toBe(20);
        store.destroy?.();
    });

    it('storage onChanged should update magnifyScale and emit settingsChanged', async () => {
        seedMinimalV4();
        const store = await freshMagnifyStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksMagnifyScale: { oldValue: 50, newValue: 0 }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.magnifyScale).toBe(0);
        expect(store.settings.magnifyScale).toBe(0);

        // defensive copy: mutating payload should not mutate store.settings
        last.data.magnifyScale = 99;
        expect(store.settings.magnifyScale).toBe(0);

        store.destroy?.();
    });

    it('storage onChanged should update showBackdrop and emit settingsChanged', async () => {
        seedMinimalV4();
        const store = await freshMagnifyStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            quicklinksShowBackdrop: { oldValue: true, newValue: false }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.showBackdrop).toBe(false);
        expect(store.settings.showBackdrop).toBe(false);

        // defensive copy: mutating payload should not mutate store.settings
        last.data.showBackdrop = true;
        expect(store.settings.showBackdrop).toBe(false);

        store.destroy?.();
    });
});

// ===== from tests/quicklinks/store-grid-density.test.js =====
/**
 * Store grid density (Launchpad columns/rows) tests
 *
 * Focus:
 * - storage changes clamp to CONFIG.GRID_DENSITY bounds
 * - clamped values update pageSizeHint (pagination view)
 */


async function freshGridStore() {
    vi.resetModules();
    const mod = await import('../../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedGridDensityItems(count) {
    const ids = [];
    const data = {
        storageVersion: 6,
        quicklinksDockPins: [],
        quicklinksItems: []
    };
    const chunk = {};

    for (let i = 0; i < count; i++) {
        const id = `qlink_${String(i).padStart(3, '0')}`;
        ids.push(id);
        chunk[id] = {
            _id: id,
            title: `Item ${i}`,
            url: `https://example.com/${i}`,
            icon: '',
            createdAt: Date.now() - i
        };
    }

    data.quicklinksItems = ids;
    data.quicklinksActiveSet = 'seed_grid_density';
    data.quicklinksChunkSet_seed_grid_density_index = ids.length > 0 ? ['quicklinksChunkSet_seed_grid_density_0'] : [];
    if (ids.length > 0) {
        data.quicklinksChunkSet_seed_grid_density_0 = chunk;
    }
    setStorageData(data, 'sync');

    return ids;
}

describe('Store grid density settings', () => {
    it('grid density should update pageSizeHint and therefore page count', async () => {
        seedGridDensityItems(30);
        const store = await freshGridStore();
        await store.init();

        // Default hint (24) => 2 pages
        expect(store.getPageCount()).toBe(2);

        // Clamp low (cols=1, rows=1) => (4 * 2) = 8 capacity
        triggerStorageChange({
            launchpadGridColumns: { newValue: 1 },
            launchpadGridRows: { newValue: 1 }
        }, 'sync');
        expect(store.settings.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MIN);
        expect(store.settings.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.ROW_MIN);
        expect(store.getPageCount()).toBe(4); // ceil(30/8)

        // Clamp high (cols=10, rows=6) => 60 capacity
        triggerStorageChange({
            launchpadGridColumns: { newValue: 10 },
            launchpadGridRows: { newValue: 6 }
        }, 'sync');
        expect(store.getPageCount()).toBe(1);

        store.destroy?.();
    });

    it('storage onChanged should clamp grid values and emit settingsChanged', async () => {
        seedGridDensityItems(1);
        const store = await freshGridStore();
        await store.init();

        const events = [];
        store.subscribe((event, data) => {
            events.push({ event, data });
        });

        triggerStorageChange({
            launchpadGridColumns: { oldValue: 6, newValue: 999 },
            launchpadGridRows: { oldValue: 4, newValue: 0 }
        }, 'sync');

        const last = events.filter(e => e.event === 'settingsChanged').at(-1);
        expect(last).toBeTruthy();
        expect(last.data.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MAX);
        expect(last.data.launchpadGridRows).toBe(store.CONFIG.GRID_DENSITY.ROW_MIN);

        // Ensure the event payload is a copy (defensive): mutating it should not mutate store.settings
        last.data.launchpadGridColumns = 4;
        expect(store.settings.launchpadGridColumns).toBe(store.CONFIG.GRID_DENSITY.COL_MAX);

        store.destroy?.();
    });
});
