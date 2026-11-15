---
id: aura-worker
type: module-design
status: draft
title: Service Worker（刷新闹钟、图标抓取代理、消息协议）
parent: aura-architecture
depends-on: [aura-platform, aura-backgrounds]
---

# Service Worker

## 这里有什么

页面上做不到或不该在页面里做的事：定时唤醒、跨域抓图标、需要 DOM 的解析。另外负责首次安装的默认值、升级后的更新日志提示。

## 消息协议

| 消息 | 方向 | 用途 |
|---|---|---|
| `fetchIcon` / `discoverIcon` | 页面 → 后台 | 抓图标、从一个页面找出候选图标地址 |
| `faviconOffscreenParsePage` / `ParseManifest` / `InspectImage` | 后台 → 隐藏页面 | 解析图标声明、读图片真实尺寸 |
| `refreshBackground` | 后台 → 页面 | 闹钟到点，通知换图 |
| `showChangelog` | 后台 → 页面 | 升级后触发更新日志 |

## 动这里会连带影响谁

- 消息名与返回结构两边都在用，改名要同步页面侧。
- 闹钟判定复用了壁纸的轮换规则，改规则会影响何时建闹钟。

## 改坏会出事的

- **闹钟只在「在线来源 + 每小时/每天」时创建**；本地文件、纯色、不轮换、每次开标签这几种不建——最后一种由页面自己在打开时判断。
- 重算闹钟要串行，避免并发清建导致闹钟丢失。
- 跨上下文传二进制必须转成数字数组，直接传 `ArrayBuffer` 在部分浏览器版本会丢数据。
- 页面没开（没有接收方）不算错误，只记真正的失败。
- 异步回包必须同步 `return true`；不认识的消息返回 `false`。
- 后台随时可能被回收，跨唤醒的状态必须存在存储里，不能只放模块变量。
