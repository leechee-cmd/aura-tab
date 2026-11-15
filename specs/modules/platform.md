---
id: aura-platform
type: module-design
status: draft
title: 平台抽象层（设置契约、存储、生命周期、i18n、备份、图标）
parent: aura-architecture
---

# 平台抽象层

## 职责

浏览器能力与跨模块公共设施的唯一定义处。业务模块不直接操作 `chrome.*` 的存储、消息、窗口交互。

只列看不出用途的部分：

| 部分 | 作用 |
|---|---|
| `settings-contract` | 全局默认值表 `SYNC_SETTINGS_DEFAULTS` + `getSyncSettings`：任何读取都必须带默认值，避免 `undefined` 漏进业务 |
| `settings-repo` | 唯一的写入通道：`navigator.locks` 的 `aura-tab:settings` 排他锁 + 进程内队列，读-改-写不互相覆盖 |
| `lifecycle` | 可销毁组件基类、拖拽状态机、定时器/事件/异步任务管理器 |
| `modal-layer` | 多模态层级：谁在最上层、点外面算不算关闭、`Esc` 交给谁 |
| `mac-window-base` / `window-interaction` | 页内伪桌面窗口：拖动、缩放、最小化、全屏、位置钳制 |
| `shortcut-manager` | 快捷键的规范化、跨平台（Mac 的 Mod 映射）、匹配与展示 |
| `i18n` | `scripts/platform/locales/` 下的三套文案 + `data-i18n` 回填 + 语言切换事件 |
| `icon-cache` | IDB 图标缓存（`aura-tab-icon-cache`），带订阅同步与清理 |
| `icon-fetch-bridge` / `favicon-offscreen` | 页面与 Service Worker 之间的图标抓取协议两侧实现 |
| `backup-manager` | zip 打包与还原：sync/local、五个 IndexedDB 库、暂存库校验后切换 |
| `toolbar-icon-service` / `toolbar-icon-renderer` | 自定义工具栏图标的**遗留**逻辑，现在只用于从旧备份还原（该功能已在 3.5.3 移除） |
| `shared/webdav-client` | WebDAV 的 PROPFIND/PUT/GET，给备份用 |

## 边界

- 只向下依赖 `shared/` 与 `libs/`。唯一的例外是引用壁纸模块的默认值表（见 [aura-architecture](../architecture.md)）。
- 不包含业务判断：什么该刷新、什么该存、文案说什么，属于各 domain。

## 不变量

- 设置只有两个写入口（`patchSyncSettings` / `patchBackgroundSettings`），且都在锁上串行。
- 所有读写存储的并发点都用 `navigator.locks` 的命名锁：`aura-tab:settings`（设置）、`aura-tab:store`（快速链接）、`aura-tab:library` 与 `aura-tab:library-download`（壁纸收藏库）、`aura-tab:local-files`（本地壁纸），不用内存标志位代替。
- `_locales/` 只保留 manifest 需要的键；界面文案只放 `scripts/platform/locales/`。
- 备份带 `schemaVersion`，还原时先写 `aura-tab-restore-staging`，校验通过再替换正式库。
- 所有组件实现 `destroy()`，销毁后不再持有定时器、监听器或 object URL。
