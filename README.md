# Lychee Tab

[![Tests](https://github.com/leechee-cmd/aura-tab/actions/workflows/ci.yml/badge.svg)](https://github.com/leechee-cmd/aura-tab/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/leechee-cmd/aura-tab/releases)

A calm, fast new tab for Chrome and Edge: 4K wallpapers, dynamic light, a macOS-style Dock and
Launchpad, quick links, and an immersive photo viewer. Everything stays on your device.

[English](#features) | [中文](#功能特性)

---

## Features

- 🎨 **Smart Backgrounds**: Auto-crop based on screen size with focal point detection, smart aspect ratio adaptation
- 🖼️ **Multiple Sources**: Support for local files, Unsplash, Pixabay, and Pexels with configurable rotation
- 🔗 **Quick Links Manager**: Folder support, drag-and-drop sorting, instant search, pagination, and pin to dock
- 📑 **Bookmark Import**: One-click import from browser bookmarks with automatic deduplication
- 🎬 **Smooth Transitions**: Beautiful fade animations when switching backgrounds with configurable interval
- 🌐 **i18n Support**: Full Chinese (Simplified/Traditional) and English localization
- ⚡ **Performance First**: First Paint optimization, background caching with TTL, lazy loading
- 📱 **Responsive Design**: Adapts to different screen sizes, densities, and orientations
- 🔒 **Privacy Focused**: WebDAV backup support for Nutstore, Synology NAS, etc., no data collection
- 🖼️ **Immersive Photo Viewer**: Fullscreen browsing with keyboard navigation and EXIF display
- ⚙️ **Flexible Settings**: Background blur effects, clock styles, search engine customization
- 📦 **Launchpad Mode**: macOS-style application launcher with folder organization
- 🔄 **Auto-refresh**: Configurable background refresh with warmup cache strategy

## Screenshots

### Desktop Experience

![Desktop](assets/other/desktop.png)

### Dock & Quick Links

![Dock](assets/other/Dock.png)

### Launchpad Mode

![Launchpad](assets/other/launchpad.png)

### Settings Window

![Settings](assets/other/setting.jpg)

### Photo Viewer

![Photo Viewer](assets/other/photo.jpg)

### More Features

![Features](assets/other/case.jpg)

## Installation

### Microsoft Edge Add-ons

Store listing in progress. Until it is live, use the manual installation below.

### Manual Installation (Developer Mode)

1. Download the latest release from [Releases](https://github.com/leechee-cmd/aura-tab/releases)
2. Unzip the file
3. Open Chrome/Edge and navigate to `chrome://extensions` or `edge://extensions`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select the unzipped folder
6. Open a new tab to see Lychee Tab in action

## Development

### Prerequisites

- Node.js 20.19+
- npm or pnpm

### Setup

```bash
# Clone the repository
git clone https://github.com/leechee-cmd/aura-tab.git
cd aura-tab

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Build the store package
./package_extension.sh
```

### Project Structure

```
Lychee Tab/
├── scripts/
│   ├── boot/           # First paint optimization
│   ├── domains/        # Feature modules (DDD architecture)
│   │   ├── backgrounds/    # Background system
│   │   ├── quicklinks/     # Quick links & launchpad
│   │   ├── settings/       # Settings window
│   │   ├── bookmarks/      # Bookmark import/export
│   │   ├── photos/         # Immersive photo viewer
│   │   └── changelog/      # Version changelog
│   ├── platform/       # Platform abstractions
│   └── shared/         # Shared utilities
├── specs/              # Spec graph (architecture and module contracts)
├── tests/              # Test files (Vitest)
├── styles/             # CSS styles
├── assets/             # Icons, backgrounds, store changelog
└── _locales/           # i18n translations
```

### Architecture

This project follows **Domain-Driven Design (DDD)** principles:

- **Domain Layer**: Business logic organized by feature domains
- **Platform Layer**: Abstracted storage, lifecycle, and messaging
- **Shared Layer**: Common utilities and helpers

The dependency direction is enforced: `domains/ → platform/ → shared/`. See [specs/](specs/) for the
module contracts and the invariants that must not break.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Adding or updating tests
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Build process or auxiliary tool changes

## Changelog

See [assets/changelog.json](assets/changelog.json) for the version history shown inside the extension.

### v1.0.0

- First release on Microsoft Edge Add-ons
- 4K wallpapers from Unsplash, Pixabay, Pexels and Bing, or your own local images
- macOS-style Dock and Launchpad with folders, drag sorting and instant search
- Immersive photo viewer with EXIF details and keyboard navigation
- Everything stays on your device: no account, no telemetry, no uploads

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

Lychee Tab is an independent fork of [Aura Tab](https://github.com/nil-byte/aura-tab), which is also MIT
licensed. The original copyright notice is kept in [LICENSE](LICENSE) as the license requires.

## Acknowledgments

This project uses the following open-source libraries:

- [Interact.js](https://interactjs.io) - Drag and drop, resizing and multi-touch gestures
- [SortableJS](https://sortablejs.github.io/Sortable) - Reorderable drag-and-drop lists
- [fflate](https://github.com/101arrowz/fflate) - High performance compression library

Background image sources:

- [Unsplash](https://unsplash.com) - Beautiful free photos
- [Pixabay](https://pixabay.com) - Free images and videos
- [Pexels](https://pexels.com) - Free stock photos

---

## 功能特性

- 🎨 **智能背景系统**：根据屏幕尺寸自动裁剪、焦点检测、智能宽高比适配
- 🖼️ **多源支持**：本地文件、Unsplash、Pixabay、Pexels，可配置轮播
- 🔗 **快速链接管理器**：文件夹支持、拖拽排序、即时搜索、分页、固定到 Dock
- 📑 **书签导入**：一键从浏览器书签导入，自动去重
- 🎬 **平滑过渡动画**：切换背景时淡入淡出，可配置切换间隔
- 🌐 **国际化**：完整的中英文（简/繁）支持
- ⚡ **性能优先**：首屏优化、背景缓存、TTL 管理、懒加载
- 📱 **响应式设计**：适配不同屏幕尺寸、密度和方向
- 🔒 **隐私保护**：支持 WebDAV 备份（坚果云、群晖等），不收集任何数据
- 🖼️ **沉浸式照片查看器**：全屏浏览、键盘导航、EXIF 信息显示
- ⚙️ **灵活设置**：背景模糊效果、时钟样式、搜索引擎自定义
- 📦 **启动台模式**：macOS 风格的应用启动器，支持文件夹组织
- 🔄 **自动刷新**：可配置的背景刷新，预热缓存策略

## 安装

### Microsoft Edge 加载项

商店列表正在准备中。上架前请用下面的手动安装方式。

### 手动安装（开发者模式）

1. 从 [Releases](https://github.com/leechee-cmd/aura-tab/releases) 下载最新版本
2. 解压文件
3. 打开 Chrome/Edge，访问 `chrome://extensions` 或 `edge://extensions`
4. 开启右上角"开发者模式"
5. 点击"加载已解压的扩展程序"，选择解压后的文件夹
6. 打开新标签页即可使用

## 开发

```bash
git clone https://github.com/leechee-cmd/aura-tab.git
cd aura-tab
npm install
npm test
./package_extension.sh   # 打出商店安装包
```

依赖方向固定为 `domains/ → platform/ → shared/`。模块契约和不可破坏的约束见 [specs/](specs/)。

## 更新日志

见 [assets/changelog.json](assets/changelog.json)。

### v1.0.0

- 首个版本，上架 Microsoft Edge 加载项商店
- 来自 Unsplash、Pixabay、Pexels 与 Bing 的 4K 壁纸，也支持自己的本地图片
- macOS 风格 Dock 与启动台：文件夹、拖拽排序、即时搜索
- 沉浸式照片查看器：EXIF 信息与键盘浏览
- 数据全部留在本地：不需要账号，不上传任何内容

## 许可

MIT 许可，见 [LICENSE](LICENSE)。

Lychee Tab 是 [Aura Tab](https://github.com/nil-byte/aura-tab) 的独立分支，上游同样以 MIT 许可发布。
按许可证要求，原始版权声明保留在 [LICENSE](LICENSE) 中。

## 感谢

如果这个项目对你有帮助，请给个 ⭐ Star！

欢迎通过以下方式支持项目：
- 提交 Issue 或 Pull Request
- 向朋友推荐
