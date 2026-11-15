---
id: aura-photos
type: module-design
status: draft
title: 照片查看器
parent: aura-architecture
depends-on: [aura-backgrounds, aura-platform]
---

# 照片查看器

## 职责

一个独立的浏览窗口，用来把壁纸库当成照片库来翻：挑一张设为壁纸，或者收藏起来。

- **来源**：收藏（壁纸资产库里的条目）、本地文件、以及四个在线来源（Unsplash / Pixabay / Pexels / Bing）。
- **列表**：按分类分页浏览，分类计数有缓存，条目顺序由来源决定（收藏按资产库里加入的顺序，不重排）。
- **全屏查看**：`immersive-viewer.js` 负责全屏浏览与键盘操作——`←`/`→` 前后切换、`Esc` 退出、`f` 收藏、`d` 下载、`i` 信息面板、`Enter` 设为壁纸。
- **缩略图**：经壁纸资产库缓存为 webp；资产库不可用（降级）时直接用远端 URL，不做缓存。

## 边界

- 依赖壁纸模块的资产库与素材读取，不自己实现下载、压缩或缓存。
- 设置壁纸走壁纸系统对外暴露的入口，不直接写 `backgroundSettings`。
- 依赖 `platform/` 的窗口外壳、模态层、i18n 与 toast。

## 不变量

- 收藏的唯一真相是壁纸资产库；查看器里的收藏状态必须由它派生，不能各自记一份。
- 滑动或翻页时预加载相邻图片，但不无限增长预加载缓存。
- 关闭窗口要释放所有 object URL。
- 资产库降级时功能降级但不报错：没有缩略图就用原图。
