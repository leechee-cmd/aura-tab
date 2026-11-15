---
id: aura-shell
type: module-design
status: draft
title: 新标签页外壳（首屏、布局、时钟、搜索）
parent: aura-architecture
depends-on: [aura-platform, aura-quicklinks]
---

# 新标签页外壳

## 职责

新标签页这一层的编排者：把壁纸、时钟、搜索、入口挂到页面上，并决定谁先启动。

- **首屏交接**：`boot/first-paint.js` 是普通 script，在模块加载前用 `localStorage` 里的颜色与低分辨率快照把背景画上，并暴露 `__AURA_FIRST_PAINT__`。`main.js` 先 arm，等到 `background:applied` 事件或 3 秒超时再 disarm，把画面交给真正的背景。
- **初始化顺序**：语言 → 主题 → HTML 文案回填 → 更新日志与背景系统（异步、不阻塞）→ 布局 / 时钟 / 搜索（同步）→ 空闲时挂载快速链接、壁纸资产库、设置窗口的懒加载。
- **布局**：搜索框展开与收起（状态存 `searchActive`）、四角容器、背景刷新按钮，以及全局快捷键（聚焦搜索、打开启动台）。
- **时钟**：时间与日期格式由设置决定（12/24 小时、秒、中英文日期）。
- **搜索**：提交查询、切换搜索引擎（模态选择器）、按设置决定当前页还是新标签打开。

## 边界

- 向下只用 `platform/` 与 `shared/`；不直接碰 IndexedDB 或 sync 存储结构。
- 对快速链接只有一个接触点：布局层调用启动台的开与关（现状耦合，见 [aura-architecture](../architecture.md)）。
- 时钟、搜索、布局都是各自独立的 `DisposableComponent`，销毁时一并解绑监听与定时器。

## 不变量

- 阻塞首屏的事情一件都不能做：背景与更新日志都异步启动，且失败不能连带清掉首屏。
- 页面就是一次性加载：任何跨标签页要保留的状态必须进存储，内存态随标签页消失。
- 语言或主题变化要能就地生效，不要求刷新页面。
