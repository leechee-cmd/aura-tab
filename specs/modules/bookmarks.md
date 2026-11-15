---
id: aura-bookmarks
type: module-design
status: draft
title: 书签导入与导出
parent: aura-architecture
depends-on: [aura-quicklinks, aura-platform]
---

# 书签导入与导出

## 职责

把浏览器的书签树搬进快速链接，或者把快速链接搬出去。

- **导入**（`importer.js` + `ui.js`）：读 `chrome.bookmarks.getTree()`，按文件夹分组，预览分页结果，确认后批量写入快速链接 store。
- **导出**（`exporter.js` + `export-ui.js`）：支持 JSON、HTML（Netscape 书签文件格式）、CSV 三种格式，保留分页结构。
- **校验**（`validator.js`）：并发 5 个请求、单个 8 秒超时的存活检查；可疑状态码（需要登录、Cloudflare 拦截）不判死，避免误报。

## 边界

- 写入只调快速链接的 store 批量接口，不自己拼 sync 结构。
- 不改变浏览器的书签，只读；导出也只读快速链接。
- 去重与 URL 规范化用 `shared/text`，两处共用同一套规则。

## 不变量

- **去重先于分页**：按规范化 URL 比对已有条目，重复的不进预览。
- 单次导入上限 500 条，超出部分截断并明确告知截断多少。
- 两种分页策略：智能压缩（按目标每页条数尽量填满）与严格分页（一文件夹一页）；条目数量极端（≥1000）时如实标记为极端情况。
- 导入是按页批量提交的，中途某页失败不能让前面已成功的页丢失或重试两遍。
- 校验只是辅助信息，不会因此自动删除条目。
