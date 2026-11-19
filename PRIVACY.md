# Lychee Tab — Privacy Policy

_Last updated: 2026-11-19_

Lychee Tab is a new tab extension. It has no account system, no analytics, no telemetry, and no server of
its own. This policy states plainly what is stored on your device and what leaves it.

## What stays on your device

Everything below is stored locally by your browser, under the extension's own storage. It is never
uploaded to us — we have no server to upload it to.

| Data | Where it is stored |
|---|---|
| Settings (appearance, clock, Dock, search engine, shortcuts) | Extension storage (local, part of it synced by your browser's own sync if you enabled it) |
| Quick links, folders, their icons and colors | Extension storage, plus the browser's sync storage |
| Wallpapers and local images you added | IndexedDB inside the extension |
| Cached wallpapers downloaded from image services | IndexedDB inside the extension |
| Cached website icons for your quick links | IndexedDB inside the extension |
| Your last searches (used for search suggestions and history) | Extension storage |
| A one-frame snapshot of colors used for instant first paint | Extension local storage |
| API keys for Unsplash / Pixabay / Pexels, and WebDAV server address and credentials | Extension local storage |

## What leaves your device

Only these requests are made, and only as a direct result of a feature you enabled.

1. **Wallpaper services.** When you choose Unsplash, Pixabay, Pexels or Bing as a background source, the
   extension requests images from that service. Requests go to the service you picked, using the API key
   you entered. That service's own privacy policy applies to those requests.
2. **Website icons.** For each quick link you add, the extension requests `favicon.ico` from that
   website's own domain. If that fails, it requests the icon from Google's favicon service
   (`www.google.com/s2/favicons`). Only the domain of a link you added is sent — never the page you are
   currently reading, and never your browsing history.
3. **Search suggestions.** As you type in the search box, the typed text is sent to the search engine
   you selected, so it can return suggestions. This can be turned off in Settings.
4. **WebDAV backup.** If you configure WebDAV backup (for example Nutstore or a Synology NAS), backup
   archives are uploaded to the server address you provided. The address and credentials stay in local
   storage and are sent only to that server.

There is no other network traffic. There is no analytics SDK, no crash reporter, no A/B testing service,
and no advertising.

## What the extension does not do

- It does not read, collect, or transmit your browsing history.
- It does not run on websites. It only replaces the new tab page.
- It does not load remote code. All code is shipped inside the package, and the content security policy
  allows only scripts from the package itself.
- It does not import bookmarks unless you click import, and the imported data stays local.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Save your settings, quick links, and cached wallpapers locally |
| `alarms` | Rotate the wallpaper on the interval you set |
| `search` | Send your search to the search engine you selected |
| `favicon` | Show a site's icon for a quick link |
| `bookmarks` | Import bookmarks when you ask for it |
| `offscreen` | Parse websites in a hidden page so the background worker can extract an icon |
| Host access | Download wallpapers, fetch website icons, query search suggestions, and reach the WebDAV server you configured |

## Deleting your data

Removing the extension from your browser deletes all of its local storage. You can also clear individual
data from Settings, and export or restore a full backup there.

## Contact

Questions about this policy: open an issue at
<https://github.com/leechee-cmd/aura-tab/issues>.

---

# Lychee Tab（荔枝）隐私政策

_最后更新：2026-11-19_

Lychee Tab 是一个新标签页扩展。它没有账号系统、没有统计分析、没有遥测，也没有自己的服务器。这份政策说明什么数据留在你的设备上、什么数据会离开。

## 留在设备上的数据

以下内容全部由浏览器保存在本机，属于扩展自己的存储，不会上传给我们——我们没有可以接收它的服务器。

- **设置**：外观、时钟、Dock、搜索引擎、快捷键。
- **快速链接**：链接、文件夹、图标与颜色（会随浏览器自带的同步功能同步，如果开启了同步）。
- **图片**：你添加的本地图片、从图片服务下载的壁纸、下载后的缓存，都存在扩展的 IndexedDB 里。
- **网站图标缓存**：快速链接对应的站点图标。
- **搜索记录**：用于搜索建议与历史。
- **首屏快照**：一帧颜色数据，用来让新标签页打开得瞬间就有颜色。
- **API 密钥与备份配置**：Unsplash / Pixabay / Pexels 的密钥，以及 WebDAV 服务器地址与凭据。

## 会离开设备的数据

只有下面四种请求，且都只在你主动开启对应功能时发生。

1. **壁纸服务**：选择 Unsplash、Pixabay、Pexels 或 Bing 作为壁纸来源时，扩展用你填的密钥向该服务请求图片。该服务自己的隐私政策约束这些请求。
2. **网站图标**：为你添加的每个快速链接，向该网站自己的域名请求 `favicon.ico`；取不到时改向 Google 的图标服务（`www.google.com/s2/favicons`）请求。只涉及你添加的链接域名，不涉及你正在浏览的页面，也不涉及浏览历史。
3. **搜索建议**：在搜索框输入时，把输入的文字发给你选定的搜索引擎以获取建议。可在设置里关闭。
4. **WebDAV 备份**：如果你配置了 WebDAV（例如坚果云、群晖 NAS），备份包会上传到你填写的服务器地址。地址与凭据只存在本地。

除此之外没有任何网络请求。没有统计分析 SDK、没有崩溃上报、没有 A/B 测试服务、没有广告。

## 不会做的事

- 不读取、不收集、不传输你的浏览历史。
- 不在任何网站上运行，只替换新标签页。
- 不加载远程代码。所有代码都在安装包里，内容安全策略只允许运行包内脚本。
- 不在你点击导入之前读取书签；导入的数据只留在本地。

## 删除数据

在浏览器里移除扩展，就会删除它的全部本地存储。也可以在设置里逐项清理，或导出、恢复完整备份。

## 联系

关于这份政策的问题，请在 <https://github.com/leechee-cmd/aura-tab/issues> 提 issue。
