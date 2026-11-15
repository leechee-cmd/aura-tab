---
id: aura-backgrounds
type: module-design
status: draft
title: 壁纸系统（来源、裁剪、缓存、轮换）
parent: aura-architecture
depends-on: [aura-platform]
---

# 壁纸系统

## 职责

把一张图变成新标签页的背景，并管住这件事的成本（内存、磁盘、网络、等待时间）。

- **来源**：本地文件、Unsplash、Pixabay、Pexels、Bing。四个在线 provider 各有请求构造与响应解析，只有需要 API Key 的才校验 Key；Bing 不需要。
- **编排**：`controller.js` 管状态与切换流程；`controller-actions.js` 放不碰 DOM 的策略函数（超时、渲染模式、预加载判断）与互斥锁、纹理管理。
- **图像处理**：`image-pipeline.js` 压缩到两档尺寸（全图 2560×1440、小图 640×360）、预加载、blob URL 生命周期、取平均色、按屏幕宽高比做焦点感知的裁剪分析。
- **本地文件**：原图存 IndexedDB（`aura-tab-local-files`），同样存 full/small 两份。
- **缓存**：远程图片进 Cache Storage（`aura-tab-backgrounds`），上限 120 条 / 220MB / TTL 14 天，按 LRU 淘汰。
- **收藏**：`library-store.js` 在 sync 里存条目、`assets-store.js` 在 IDB 里存图（缩略图 webp 640×360，全图上限 1GB / 300 条）；被收藏的图不参与淘汰。

## 边界

- 依赖 `platform/`（i18n、网络超时、toast、错误去重）与 `shared/`。
- 被外壳、照片查看器、设置面板使用；它自己不知道快速链接的存在。
- 所有壁纸设置都在 `backgroundSettings` 这一个 sync 键下，写入统一走 `patchBackgroundSettings`。

## 不变量

- **换图策略按来源分叉**：在线源 + 智能裁剪走单阶段直出；本地文件走渐进式（先小图后大图）。在线源在「每次开标签」频率下不预加载下一张——预加载比直接换更贵。Bing 忽略用户设定的频率，按自然日换。
- **失败不能白屏**：抓取失败回落到缓存、上一次的背景、或纯色 + 首屏快照。
- **一次只做一件事**：切换用互斥锁串行，避免并发切换把 blob URL 与 DOM 状态搞乱。
- **容量上限写死在常量里**（本地 50 个 / 200MB / 单文件 20MB，缓存与资产库见上），超限时淘汰或拒绝，不静默丢数据。
- 图片只在页面里 `fetch`；跨上下文只传 `number[]`，不传 `ArrayBuffer`。
