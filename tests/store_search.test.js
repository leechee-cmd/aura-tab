/**
 * Store search tests
 *
 * Focus:
 * - 按空格分词：每个词都要命中（AND）
 * - URL 归一：https://、www.、末尾斜杠不参与匹配
 * - 打分：标题前缀 > 标题子串 > 标签 > 域名 > 路径
 * - 文件夹只按标题匹配
 */

import { describe, it, expect, vi } from 'vitest';
import { setStorageData } from './setup.js';

async function freshStore() {
    vi.resetModules();
    const mod = await import('../scripts/domains/quicklinks/store.js');
    return mod.store;
}

function seedItems(items) {
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
    seedItems(items);

    const store = await freshStore();
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
