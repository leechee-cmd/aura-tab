---
id: aura-quicklinks
type: module-design
status: draft
title: 快速链接（分页、文件夹、Dock、启动台）
parent: aura-architecture
depends-on: [aura-platform]
---

# 快速链接

## 职责

新标签页上的入口集合，以及它的三种呈现：分页网格、Dock、启动台。

`store.js` 是唯一真相，其余都是视图：`link-manager` 管网格与编辑对话框，`dock` 管带放大效果的 Dock，`launchpad*` 管全屏启动器（grid / search / drag / folder 四组方法挂到同一个实例上），`context-menu` 管右键菜单，`icon-*` 管图标外观（内置站点图标、自定义图片、颜色文字图标）。

## 存储布局

条目存在 `chrome.storage.sync`，但**不是一个键**：sync 单条目上限 8KB，装不下整份数据。

- `quicklinksRevision` 是版本号，`quicklinksActiveSet` 指向当前生效的 chunk 集合，正文按 `quicklinksChunkSet_<id>_<n>` 分块写入（每块上限 7600 字节）。
- 写入是「先写新块，再翻转 active 指针，最后清理旧块」；提交失败重试 3 次。
- 结构是扁平的：`items` 是一个有序数组，用 `__PAGE_BREAK__` 哨兵切页；文件夹（`qfolder_`）与链接（`qlink_`）平级排在同一数组里，文件夹子项上限 24。

## 边界

- 依赖 `platform/`（i18n、模态层、图标缓存、SortableJS 懒加载）与 `shared/`。
- 书签导入与设置面板直接调它的 store，不经过它自己的 UI（现状耦合，见 [aura-architecture](../architecture.md)）。
- 图标二进制只在 `platform/icon-cache` 里；这里只存图标描述。

## 不变量

- **写 sync 前先算配额**：预估体积超限就返回 `SYNC_QUOTA_EXCEEDED` 并不落盘，绝不做半截写入。
- 视图只读 store 的缓存快照，写操作一律回到 store，多视图（网格 / Dock / 启动台）对同一份数据保持一致。
- URL 只接受 `http(s)`、`chrome`、`chrome-extension`、`edge`、`about`；`javascript`、`data`、`vbscript`、`blob` 一律拒收。
- 参数越界一律 clamp 而不是报错：Dock 数量 0–20、放大强度 0–100、启动台 4–10 列 / 2–6 行。
- 图标加载失败回落到首字母文字图标，不留空白格。
- 拖拽期间禁止其他操作（拖拽状态机有冷却期），避免拖到一半触发重排或编辑。
