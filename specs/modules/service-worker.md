---
id: aura-worker
type: module-design
status: draft
title: Service Worker（刷新闹钟、图标抓取代理、消息协议）
parent: aura-architecture
depends-on: [aura-platform, aura-backgrounds]
---

# Service Worker

## 职责

页面上做不到、或不该在页面里做的事：定时唤醒、跨域抓图、需要 DOM 的解析。

- **刷新闹钟**：只有在线来源且频率为每小时 / 每天时才建闹钟（`refreshBackground`，周期 60 / 1440 分钟，首次延迟最多 3 分钟）。本地文件与纯色、`never`、`tabs` 都不建——`tabs` 由页面打开时自己判断。
- **重算时机**：`onInstalled`、`onStartup`，以及 sync 里 `backgroundSettings` 的 `type` 或 `frequency` 变化时。三次重算都排在同一条 promise 链上串行，避免闹钟被并发清建。
- **抓图标**：`fetchIcon` / `discoverIcon` 两个消息，3 秒超时、只接受 `image/*`、单文件上限 512KB、只允许 `http(s)` 与扩展自己的 `/_favicon/` 端点。
- **解析**：offscreen 文档（`favicon-offscreen.html`）解析页面里声明的图标、校验图片尺寸；文档按需创建、全局单例。
- **初始化与广播**：首次安装写入默认 `backgroundSettings`；更新时广播 `showChangelog`。

## 消息协议

| 消息 | 方向 | 用途 |
|---|---|---|
| `fetchIcon` | 页面 → SW | 抓一个图标，回 `{success, data: number[], contentType}` |
| `discoverIcon` | 页面 → SW | 从一个页面 URL 里找出候选图标地址 |
| `faviconOffscreenParsePage` / `ParseManifest` / `InspectImage` | SW → offscreen | 解析图标声明、读图片真实尺寸 |
| `refreshBackground` | SW → 页面 | 闹钟到点，通知页面换图 |
| `showChangelog` | SW → 页面 | 升级后触发更新日志 |

## 不变量

- **二进制跨上下文一律转 `number[]`**，不传 `ArrayBuffer`——结构化克隆在部分浏览器版本会丢数据。
- 没有接收方（页面没开）不是错误：`Could not establish connection` 一类异常要吞掉，只记真正的失败。
- `onMessage` 必须同步 `return true` 才能异步 `sendResponse`；不认识的消息返回 `false`。
- SW 随时可能被回收，任何跨唤醒的状态都必须在存储里，不能只放模块变量。
- 抓取前校验协议与体积，抓取后校验 `content-type`；不满足就返回失败而不是把可疑数据塞给页面。
