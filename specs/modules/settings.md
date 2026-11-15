---
id: aura-settings
type: module-design
status: draft
title: 设置窗口与数据备份
parent: aura-architecture
depends-on: [aura-platform, aura-quicklinks, aura-changelog]
---

# 设置窗口与数据备份

## 职责

以「伪桌面窗口」形式打开的新标签页内设置面板（不是浏览器选项页），也是绝大多数设置项的写入方。

- **窗口**：`mac-window-base` + `window-interaction` 提供拖动、缩放、最小化、全屏、关闭、焦点归还；同时只能有一个模态在最上层，由 `modal-layer` 统一管。
- **分区**：常规（时钟、搜索、快捷键）、外观（主题、壁纸各参数、API Key、工具栏图标）、Dock（快速链接的呈现参数）、数据（导出 / 导入 / WebDAV）、关于、更新日志。
- **表单**：`builder.js` 按声明式配置生成控件行，写操作统一走声明里的 `write` 回调。
- **数据**：整库导出与导入（zip，含各 IndexedDB 库与 sync/local 数据），以及 WebDAV（服务器地址、远端目录、账号密码）上传与恢复。

## 边界

- 读设置只经 `getSyncSettings`，写只经 `patchSyncSettings` / `patchBackgroundSettings`；内容分区不直接调 `chrome.storage`。
- 对快速链接只改配置（Dock、启动台网格），不碰条目本身。
- 更新日志分区由 `changelog` 模块注册，本模块只提供挂载点。
- 备份的具体打包与还原在 `platform/backup-manager`，本模块只做界面与流程。

## 不变量

- 破坏性操作（清空数据、从备份还原）必须先过确认对话框。
- 备份与还原期间挂保护遮罩并阻止关页面；还原先写暂存库，校验通过才切到正式库。
- 设置项一旦改动立即持久化，没有「保存」按钮。
- 窗口关闭要把焦点还给打开它的按钮。
