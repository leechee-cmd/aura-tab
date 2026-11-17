/**
 * 链接搜索的用例表
 *
 * 跑一份固定的语料，然后按「用户会怎么搜」逐条问：名字、网址、标签、多个词、
 * 中文、大小写、端口、路径、符号。这一组不追求实现细节，只描述期望结果。
 */

import { describe, it, expect, vi } from 'vitest';
import { setStorageData } from './setup.js';

async function freshStore() {
    vi.resetModules();
    return (await import('../scripts/domains/quicklinks/store.js')).store;
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

    const store = await freshStore();
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
