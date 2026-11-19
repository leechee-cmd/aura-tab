# 素材生成指令包

给 Gemini 用。分三部分：哪些能生成、给它的提示词、生成完还要手工做什么。

## 一、先分清三类

| 类别 | 素材 | 能不能让 AI 做 |
|---|---|---|
| 让 AI 画 | 图标母版、商店 logo、小促销图、大促销图 | ✅ 可以，但要后期处理 |
| 只能实拍 | 商店截图（1–6 张 × 每语言） | ❌ **不行，必须是真实运行界面** |
| 只能手工 | 16×16 / 48×48 图标 | ❌ AI 生成的缩小必糊，见第四节 |

**为什么截图不能生成**：商店要求「描述与实际一致」。用 AI 画的界面图，皮上和真产品不一样，审核比到描述会退回；就算过了，用户装上发现不是图里那样，评分直接崩。截图只能开真扩展截。

## 二、色板（取自产品现有 CSS，别自己发明）

```
壳红（主色）   #C02A2C    深阶 #74161B    亮阶 #F0675A
果肉（半透明） #FFFFFF 95% → #FFE3DA 62% → #FFB9A8 38%
核            #251A1E  →  #5A3A42
暖光晕        #FFB3A7  /  #FFD9CF
系统强调蓝    #0A84FF    （产品现有 accent，促销图里呼应 UI 用）
```

产品本身的视觉是「macOS 系统色 + 白色光球 + 毛玻璃」，所以图标不要用荧光色、不要用浓紫渐变的 AI 味配色，红 + 半透明白 + 深褐这三个就够了。

## 三、提示词

统一加在每条末尾的**负面词**：

```
Negative: no text, no letters, no numbers, no watermark, no signature,
no border, no frame, no drop shadow outside the shape, no photographic
realism, no droplets, no leaves, no stem, no multiple fruits, no busy texture
```

统一要求的**构图约束**：

```
Composition: single centered mark, generous empty margin around it (about 12%
of the canvas on every side), the mark must stay readable when scaled down
to 16 pixels.
```

### 3.1 图标母版（1024×1024，三选一）

先让 Gemini 把主形画出来，你挑一个当品牌形。

**方向 A — 剖面（推荐用于 128px）**

```
A single square app icon, 1:1, flat vector illustration style with soft gradient
shading, no 3D render look.

Subject: a lychee fruit cut in half, viewed straight on as a cross section.
Concentric structure from outside in: (1) a thick outer ring in deep lychee-shell
red (#C02A2C) with a slight darker edge (#74161B); (2) a broad translucent flesh
area in white with a warm tint fading from #FFFFFF at 95% opacity to #FFB9A8 at
about 40% opacity; (3) one small dark seed in the center (#251A1E) with a soft
highlight toward the upper left.

Add one clean crescent specular highlight on the upper-left of the ring, and a
very subtle inner glow inside the flesh. Keep the shapes perfectly geometric
(circles, one crescent). No scales, no skin texture, no leaves.

Background: solid warm off-white (#F6F1EC). The mark occupies about 76% of the canvas.
```

**方向 B — 整颗（辨识度靠颜色）**

```
A single square app icon, 1:1, flat vector style with a soft glossy gradient,
minimal, no photorealism.

Subject: one whole lychee fruit standing alone, a near-perfect sphere.
Base color deep shell red (#C02A2C), darker at the bottom right (#74161B), warmer
at the top left (#F0675A). Suggest the shell's scaly pattern with only 3 to 4
very subtle thin furrow lines in a darker red at low opacity — it must not read
as texture, it should read as a single clean sphere.

One soft round highlight at the upper left. No stem, no leaf, no water drops.

Background: solid warm off-white (#F6F1EC). The sphere occupies about 78% of the canvas.
```

**方向 C — 纯几何（推荐用于 48 与 16）**

```
A single square app icon, 1:1, purist geometric mark, flat vector, two shapes only.

Subject: one small circle in the center, surrounded by a thick open ring arc that
wraps about 300 degrees around it, leaving a gap at the upper right, like a shell
partially opened. The arc is a warm red gradient from #FF7A66 to #B6282B with
rounded caps. The center dot is soft warm white (#FFF6F2) with a faint inner glow.

No other elements. Extremely simple, monoline weight consistent, designed to stay
legible at 16 pixels.

Background: solid warm off-white (#F6F1EC). The mark occupies about 74% of the canvas.
```

### 3.2 商店 logo（300×300）

不要重新生成，用上面选中的母版改底色：

```
Same mark as before, unchanged, now placed on a square 1:1 canvas with a solid
deep background (#1A1216, near-black warm brown) instead of off-white, and the
mark slightly larger (about 82% of the canvas). Add a very soft warm radial glow
(#FFB3A7 at 12% opacity) behind the mark. Keep it flat and clean, no vignette.
```

### 3.3 小促销图（440×280）

```
A wide rectangular marketing tile, 440x280 aspect ratio (11:7).

Left 55% of the canvas must stay completely empty as clean space for text that
will be added later — do not put any object or texture there.

Right side: the geometric lychee mark (open ring arc with a center dot, warm red
gradient) at about 60% of the canvas height, floating over a soft dark plum
background (#1A1216) with one large diffuse warm light orb (#FFB3A7, very low
opacity, heavy blur) behind it.

Style: modern app store promotional art, flat with soft gradients, no text.
```

### 3.4 大促销图（1400×560）

```
A wide hero banner, 1400x560 aspect ratio (5:2), for a browser new tab extension.

Background: a calm abstract gradient scene — deep plum and near-black, with two
large soft light orbs (warm #FFB3A7 and a cool #0A84FF at low opacity), heavy blur,
no visible banding. Suggest a frosted glass surface at the bottom edge only.

Foreground right third: the geometric lychee mark (open ring arc, center dot, warm
red), semi-transparent frosted glass plate behind it.

Left two-thirds: keep clean and quiet — large empty area intended for a headline
added later. No text, no UI screenshots, no device mockups.
```

## 四、生成完之后必须手工做的三件事

### 1. 16×16 和 48×48 必须重画，不能缩放

AI 出的是 1024 的图，直接缩到 16px 会糊成一团。做法：把 1024 的图当参考，在 16px 画布上只留两个形状 —— 一圈弧 + 一个实心点，两个颜色，别的一律删掉。48px 同理但可以保留高光。

判断标准：缩到 16px，铺在深色和浅色两种背景上各看一眼，认得出就算过。

### 2. 背景抠掉

Gemini 一般不出透明背景（要求 transparent 也常常给个白底或棋盘格画上去）。所以：让它给纯色底（上面提示词里已经指定 `#F6F1EC` 或 `#1A1216`），回头用任意工具去底，导出透明 PNG。

### 3. 促销图的文字不要给 AI

AI 生成的英文单词会拼错，中文会画成乱码。让小促销图和大促销图各自留出左侧空白，文字回头在 Figma / Canva / PPT 里加，字体用系统字体就够（`SF Pro` / `PingFang SC` / `Segoe UI`）。

## 五、导出清单

| 文件 | 尺寸 | 背景 | 用途 |
|---|---|---|---|
| `assets/icons/icon128.png` | 128×128 | 透明 | 安装对话框、商店卡片 |
| `assets/icons/icon48.png` | 48×48 | 透明 | 扩展管理页 |
| `assets/icons/icon16.png` | 16×16 | 透明 | 工具栏、标签页 |
| `assets/store/logo-300.png` | 300×300 | 可带底色 | 商店 logo |
| `assets/store/tile-440x280.png` | 440×280 | 可带底色 | 小促销图 |
| `assets/store/tile-1400x560.png` | 1400×560 | 可带底色 | 大促销图 |
| `docs/images/icon128.png` | 128×128 | 透明 | 落地页 |

三张图标现在都是同一张 1254×1254 的图（上游留下的），导出真尺寸后覆盖掉即可。`assets/store/` 不在打包白名单里，不会进安装包。

## 六、几个容易踩的坑

- **三个方向别混用**：一旦选了 A 或 C，128、48、16 三档要同一个品牌形，不要一档一个样。
- **不要让 AI 加「玻璃质感 / 3D 渲染」到图标上**：小尺寸下高光和倒角会变成脏点。产品界面的毛玻璃感留在截图里体现，图标要平。
- **不要出现水果组合**：一棵树、一串荔枝、叶子，全部让负面词挡掉。
- **促销图别放截图**：440×280 里塞界面会缩到看不清，写一句主张 + 一个形就够。
