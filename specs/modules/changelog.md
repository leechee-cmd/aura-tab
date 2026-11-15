---
id: aura-changelog
type: module-design
status: draft
title: 版本更新日志
parent: aura-architecture
depends-on: [aura-settings, aura-platform]
---

# 版本更新日志

## 职责

扩展升级后，第一次打开新标签页时把这一版的改动摆给用户看；并长期挂在设置窗口里。

- **数据**：`assets/changelog.json`，按版本号分条，每条含 `en` / `zh_CN` / `zh_TW` 三份文案与可选的 `moreUrl`。
- **何时弹**：`chrome.storage.local` 里的 `changelog:lastSeenVersion` 与当前版本不一致就弹；Service Worker 在 `onInstalled`（reason 为 update）时也会广播一次 `showChangelog`。
- **何时算看过**：用户关闭弹窗时才写入已读版本，不是弹出时写。
- **语言**：跟随页面语言重新挑选条目；弹窗开着时切语言会即时刷新内容。
- **入口**：弹窗里的「更多」直接打开设置窗口的更新日志分区。

## 边界

- 只读 `assets/changelog.json`，不生成、不改写它——文案由发版流程维护。
- 依赖设置窗口来展示完整历史；反过来设置窗口依赖它注册分区（双向引用，见 [aura-architecture](../architecture.md)）。

## 不变量

- 同一版本只提示一次；弹窗关掉才算提示过。
- 没有该版本的数据、或语言缺失时回落到英文，绝不弹空窗。
- 数据加载失败就静默跳过，不影响新标签页任何其他功能。
