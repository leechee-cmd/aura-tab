---
id: aura-architecture
type: architecture-design
status: draft
title: Aura Tab — 架构总览
parent: aura-goal
---

# Aura Tab — 架构总览

## 两个运行上下文

扩展由两份互不复用的 JS 运行时组成，靠消息通信：

- **新标签页文档**（`newtab.html` → `scripts/main.js`）：全部 UI 与业务逻辑。每次打开标签页都是一次全新的加载，进程随时可能被丢弃。
- **Service Worker**（`background-worker.js`）：常驻于扩展生命周期，随时可能被浏览器回收。它负责三件事：定时唤醒后台刷新（`chrome.alarms`）、代替页面抓取 favicon（绕开 CORS，二进制转 `number[]` 回传）、按需创建 offscreen 文档解析站点声明的图标。
- **offscreen 文档**（`favicon-offscreen.html`）：只做 DOM 解析，没有 UI。

页面侧从不直接抓 favicon，一律经 `platform/icon-fetch-bridge.js` 发消息；壁纸图片则由页面自己 `fetch`（`domains/backgrounds/image-pipeline.js`）。

## 分层与依赖方向

```
domains/  →  platform/  →  shared/
   ↓            ↓
 libs/  ←────────┘
```

- `domains/` 按功能划分（背景、快速链接、设置、照片、书签、更新日志）+ 页面外壳（布局、时钟、搜索）。
- `platform/` 是浏览器能力的抽象：存储契约与写入队列、生命周期、i18n、模态层、窗口交互、快捷键、图标缓存、备份。
- `shared/` 是无状态工具：DOM、存储 IDB 封装、文本与 URL 规范化、toast、favicon 拼装、网络超时、WebDAV 客户端。
- `libs/` 是原样拷贝进来的第三方库（interact.js、SortableJS、fflate），不参与 lint。

现存的反向边与跨域边，都是现状而非规则：

| 边 | 内容 | 意图 |
|---|---|---|
| `platform/settings-contract` → `domains/backgrounds/defaults` | 全局默认值表要引用壁纸默认值 | 未确认 |
| 外壳 `domains/layout` → `domains/quicklinks` | 布局层直接调用启动台开关 | 未确认 |
| `bookmarks` → `quicklinks/store` | 导入直接把条目写进快速链接存储 | 未确认 |
| `photos` → `backgrounds/assets-store` | 照片查看器的来源就是壁纸资产库 | 未确认 |
| `settings` → `quicklinks` | 设置面板直接改 Dock / 启动台配置 | 未确认 |
| `settings` ⇄ `changelog` | 设置窗口挂载更新日志分区，更新日志能打开设置窗口 | 未确认，双向引用 |

以上 6 条维护者意图未知（代码是从上游仓库取得的），新增依赖时不要把它们当作可扩展的惯例。

## 状态存放在哪

| 位置 | 存什么 | 原因 |
|---|---|---|
| `chrome.storage.sync` | 所有设置、快速链接条目与配置 | 需要跨设备同步；受约 100KB 总量、单条目 8KB 配额约束 |
| `chrome.storage.local` | 首屏颜色与预览快照、图标缓存索引、壁纸缓存索引、下载队列、更新日志已读版本 | 本机态，不值得同步 |
| `chrome.storage.session` | 壁纸外观（遮罩 / 模糊 / 亮度）的运行期镜像 | 只在本会话内有效；目前只有写入与它自己的变更监听，没有别的读者 |
| IndexedDB | 本地壁纸原图（`aura-tab-local-files`）、图标缓存（`aura-tab-icon-cache`）、工具栏图标（`aura-tab-toolbar-icon`）、备份还原暂存（`aura-tab-restore-staging`）、壁纸资产库（`aura-tab-assets`） | 二进制大对象不能进 `chrome.storage` |
| Cache Storage | 壁纸图片缓存（`aura-tab-backgrounds`，带 TTL 与容量上限） | 浏览器负责淘汰，避免自己管大文件 |

## 不变量

- **设置读写只有一个入口。** 读走 `getSyncSettings()`（默认值来自 `SYNC_SETTINGS_DEFAULTS`），写走 `patchSyncSettings` / `patchBackgroundSettings`，后者在 `navigator.locks` 的 `aura-tab:settings` 锁 + 进程内队列上串行，读-改-写不会互相覆盖。
- **大对象不进 `chrome.storage`。** 图片与二进制只进 IndexedDB 或 Cache Storage；跨上下文传二进制要转成 `number[]`（结构化克隆直接传 `ArrayBuffer` 有丢数据的实例）。
- **UI 文案只有一个家。** 页面内文案全部在 `scripts/platform/locales/`，`_locales/` 只保留 manifest 与 `chrome.i18n.getMessage` 用到的键。
- **sync 写满就快速失败。** 配额不足时不做部分写入，直接返回 `SYNC_QUOTA_EXCEEDED`。
- **页面脚本必须是外链文件。** CSP 为 `script-src 'self'`，HTML 里不允许内联事件处理器（有测试守着）。
- **首屏不能等 JS。** `scripts/boot/first-paint.js` 是普通 script（在模块之前执行），用本地缓存的颜色与低分辨率预览先把壁纸画上，模块初始化完成后再交接。

## 构建、测试与发布

- 没有构建步骤：源码即产物。`styles/bundle.css` 是手工维护的单文件样式表（另有 `styles/photos.css`）。
- 测试：Vitest + jsdom，`tests/setup.js` 用 mock 替换 chrome API；只跑单元与集成测试，没有真实浏览器的端到端。
- CI：Node 20/22 上跑 `npm test`、覆盖率、ESLint；再执行 `package_extension.sh` 打 zip。
- 发布：`package_extension.sh` 按 allowlist 打包（manifest、两个 HTML、worker、styles、scripts、`_locales`、`assets/backgrounds`、`assets/icons`、`assets/changelog.json`），`docs/`、`tests/`、`assets/other` 不进包。
