---
name: 寻迹 Mobile
description: 克制的找回工具 —— 两档中性色、一个输入框、一个强调色
colors:
  canvas: "#f6f5f1"
  surface: "#ffffff"
  sunken: "#f4f3ef"
  line: "#e8e6e1"
  line-strong: "#d6d3cc"
  ink: "#1a1917"
  muted: "#6e6c67"
  faint: "#a3a099"
  accent: "#b23a26"
  accent-quiet: "#f7eae6"
  danger: "#b3352b"
  warn: "#8a5a20"
  ok: "#2f6b47"
typography:
  display: "28px / 36px / 600 / -0.5px"
  title: "20px / 28px / 600 / -0.2px"
  heading: "16px / 24px / 600 / -0.1px"
  body: "16px / 25px / 400 / 0"
  body-sm: "14px / 22px / 400 / 0"
  caption: "12px / 18px / 400 / 0"
  label: "13px / 18px / 500 / +0.3px"
  mono: "12px / 18px / Menlo 等宽 / 0"
rounded:
  sm: "8px"
  md: "14px"
  full: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    background: "{colors.accent}"
    text: "#ffffff"
    height: "48px"
    radius: "{rounded.sm}"
    padding: "0 20px"
  button-secondary:
    background: "{colors.surface}"
    border: "1px {colors.line-strong}"
    text: "{colors.ink}"
    height: "48px"
    radius: "{rounded.sm}"
  composer:
    background: "{colors.surface}"
    border: "1px {colors.line} → 聚焦 {colors.line-strong}"
    radius: "{rounded.md}"
    minHeight: "52px"
  list-row:
    minHeight: "60px"
    separator: "1px {colors.line}"
  tab-bar:
    height: "56px + 安全区"
    borderTop: "1px {colors.line}"
    active: "{colors.ink}"
    inactive: "{colors.faint}"
---

# Design System: 寻迹 Mobile

## Overview

**Creative North Star: 「一张纸上的一件事」**

这一版把上一版的集邮册世界收起来了：邮票齿孔、销戳、盖章动画、双主题色心理战全部退场。留下的是一张纸、一支笔、一个动作。

克制在这里不是形容词，而是四条可检查的规则：

1. **一个屏幕只有一个强调色位置。** 朱红 `#b23a26` 只出现在「当前可执行的那个动作」上——首页输入框的提交键、详情页的「打开原文」、设置页的「保存设置」、聚焦时的下划线。除此之外全屏无彩。
2. **层次只用发丝线和留白。** 没有阴影、没有渐变、没有卡片投影堆叠。1px `line` 色分隔列表行，靠 16dp 留白成组。
3. **一个输入框。** 首页不再并排「提问」和「收藏」两张卡。一个框，看得出是链接就存，看不出就当一句话去搜；框下方那行小字随输入变化，告诉用户这次会做什么。
4. **状态用形状，不用颜色也读得懂。** 实心小圆＝已完成、空心＝整理中、实心带色＝部分/失败。已完成的条目不带任何状态文字——默认状态不占用眼力。

技术实现是 **NativeWind（Tailwind 4 / react-native-css-interop）**：色彩走 CSS 变量（`global.css` 的 `:root` 与 `@media (prefers-color-scheme: dark)`），明暗随系统切换；命令式取色（图标色、placeholder、RefreshControl）走 `src/ui/palette.ts`，两份值必须同步改。

## Colors

两档中性色 + 一个强调色 + 三个状态色，light / dark 各一套。

| 角色 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| canvas | `#f6f5f1` | `#10100f` | 页面底、导航栏底 |
| surface | `#ffffff` | `#1b1b19` | 抬起的表面：输入框、对话框 |
| sunken | `#f4f3ef` | `#0c0c0b` | 下沉表面：摘要块、代码块 |
| line | `#e8e6e1` | `#2b2b28` | 发丝线、分隔、描边静息态 |
| line-strong | `#d6d3cc` | `#3b3b37` | 可交互描边、输入框聚焦描边 |
| ink | `#1a1917` | `#edeae4` | 主文字、反底提示条的底 |
| muted | `#6e6c67` | `#9b9891` | 次要文字、摘要、说明 |
| faint | `#a3a099` | `#6b6862` | 极淡：栏目名、占位符、已完成状态点 |
| accent | `#b23a26` | `#e4715b` | **唯一强调色**，见 The One-Accent Rule |
| accent-quiet | `#f7eae6` | `#2e1d18` | 强调色的淡底（当前版本基本不用，留给未来的选中态） |
| danger | `#b3352b` | `#e4685c` | 删除、失败 |
| warn | `#8a5a20` | `#d9a15b` | 部分成功 |
| ok | `#2f6b47` | `#6fbe8e` | 成功（提示文字之外的场合） |

### Named Rules

**The One-Accent Rule.** 一屏只能有一个朱红动作。它的稀缺就是它的语义：这里是「你现在能做的那一件事」。两处朱红＝没有重点。

**The No-Decoration Rule.** 不引入第二个色相、不做渐变、不做齿孔/印章/贴纸这类图形隐喻。装饰只在信息真的存在时出现（来源站名、日期、状态）。

**The Paired-Sync Rule.** `global.css` 的 CSS 变量与 `src/ui/palette.ts` 是同一份颜色的两种写法，改一处必须改另一处，否则图标与文字会分家。

## Typography

**字体：系统字族。** iOS SF Pro / Android Roboto，无字体包——中文字体包动辄几 MB，换来的收益不如把字距和字重调对。

**Character:** 小步长、低对比。全站只有五档字阶：display 只出现在首页那一句问句和收藏页的数字上；title 给页面标题与详情标题；heading 给品牌名与小节标题；body 是正文；caption 承载元信息。中文大字号一律负字距（-0.2 ~ -0.5px）才紧实，正文 0，label 是唯一带正字距的字（+0.3px，栏目名与按钮），因为它要和正文拉开呼吸。

### Hierarchy

- **display** 28/36/600/-0.5 —— 首页「想找点什么？」、收藏页的计数
- **title** 20/28/600/-0.2 —— 页面标题、详情标题
- **heading** 16/24/600/-0.1 —— 品牌名、小节标题、结果行标题
- **body** 16/25/400 —— 正文、输入内容、摘要首句
- **body-sm** 14/22/400 —— 说明、摘要、按钮外的辅助文字
- **caption** 12/18/400 —— 出处 · 时间、提示、脚注
- **label** 13/18/500/+0.3 —— 按钮、动作、tab
- **mono** 12/18 —— 代码块、数字对齐场合

栏目名另有一条微样式：`text-[11px] font-semibold tracking-[1px] text-faint`（「最近收藏」「大模型（可选）」「原文」「相关」「摘要」）。它靠大写式的稀疏字距充当收束，不靠色块。

## Layout

单栏移动布局，基准 390×844。8dp 网格（4dp 半步），页面左右 gutter 16dp，底部导航 56dp + 安全区，滚动内容为它留出净空（`insets.bottom + 56 + 24`）。

页面骨架统一：顶部 56dp 高的标题行（品牌名 / 页面名，右对齐放至多一个图标按钮）→ 内容 → 底部导航（首页 / 收藏 / 我的）。

**首页三段式**：标题行 → 一句问句 + 一句说明 → 输入框 → 「最近收藏」四条。搜索后同一位置换成「找到 N 条 · 清除」+ 结果行，输入框留在原处不动。

## Motion

只保留两处：提示条 160ms 淡入上移，对话框 140ms 淡入。不做弹性动画、不做盖章、不做共享元素。系统开启「移除动画」时这两处也足够安静。

## Components

### Buttons
- **Primary**：朱红底、白字（暗色下用 canvas 墨色字）、48dp 高、8dp 圆角、水平 20dp。整屏最多一个。
- **Secondary**：surface 底 + `line-strong` 1px 描边、ink 字。次级动作。
- **Quiet**：纯文字，accent 或 danger 色，44dp 触区。
- **IconButton**：48dp 触区，无底色，按压 opacity 0.5。

### Composer（签名组件）
首页唯一的输入面。`surface` 底 + 1px 描边（聚焦变 `line-strong`），14dp 圆角，最小 52dp、最高 132dp（约五行）。右下角一个 36dp 方块提交键：未就绪时 `sunken` 底 + 极淡图标，就绪时朱红底 + 白图标；识别到链接时图标是书签，否则是向上箭头。框下一行 caption 随状态变化：空 → 提示语；有字 → 「按这句描述找回」；识别到链接 → 「保存这个链接」；出错 → 朱红错误句。

### List rows
- **RecentRow**：标题 1 行（body/500）+ 元信息 1 行（caption）+ 右侧状态标记；最小 60dp，行间 1px 发丝线。
- **ResultRow**：标题 2 行（heading/600）+ 元信息 + 摘要 2 行 + 「为什么找到它」1–2 行 + 斜体摘录 2 行。没有卡片底色、没有缩略图、没有箭头。

### Fields
- **TextField**（设置页）：11px 栏目名在上，输入框只有一条下划线，聚焦变朱红；下方可带一行 caption 说明。
- **SearchInput**（收藏页）：放大镜 + 下划线，聚焦时下划线变朱红，有内容时出现清除按钮。

### Navigation
底部导航通栏、`canvas` 底、顶部 1px 发丝线。三项：图标 21dp + 10px 标签。选中＝ink，未选＝faint。没有胶囊、没有指示条。

### 其他
- **图片**：详情页在原文之后列出正文里的图片，最多四张，单列、8dp 圆角、`sunken` 底占位，超出部分只写一行「另有 N 张未显示」。图片里的文字由端侧 OCR 全部读出（最多 24 张、单篇 45 秒预算）并接在原文末尾（`## 图片文字`），所以长文里的截屏、「一图流」这类内容也能被搜到。
- **设置子页**：「我的」只列入口（大模型摘要、本机存储、多端同步、清空），具体配置点进 `/settings/llm`。子页有返回箭头，表单在开关关闭时整体 45% 不透明。
- **ConfirmDialog**：`surface` 底、14dp 圆角、1px 描边、24dp 内距、遮罩 35% 黑；按钮靠右，取消为 quiet、确认按语义取 primary 或 destructive。
- **Toast**：`ink` 反底、`canvas` 文字、8dp 圆角，最多 3 条，浮在导航栏上方 72dp 处；动作是带下划线的文字。
- **StatusMark**：8dp 圆点。空心（`border-muted`）＝整理中并带「整理中」；实心 `faint`＝已完成（无文字）；实心 `warn`＝部分；实心 `danger`＝失败。
- **Markdown**：标题、段落、列表、引用（左侧 2px 线）、代码块（`sunken` 底）、行内代码、链接（accent + 下划线）。永不进 WebView，永不注入原始 HTML。

## Do's and Don'ts

### Do
- **Do** 让一屏只有一个朱红动作；用留白和字重做层次。
- **Do** 用 1px 发丝线分隔列表行，gutter 16dp，触区 ≥44dp（图标按钮 48dp）。
- **Do** 把「为什么找到它」写在结果行里，只用真实命中证据，不加图标。
- **Do** 首页保持「一句问句 + 一个输入框 + 最近四条」的三段式，搜索时输入框不动。
- **Do** 需要用字符串给控件上色时（Ionicons、placeholderTextColor、RefreshControl）从 `usePalette()` 取，别写死十六进制。
- **Do** 改颜色时同步 `global.css` 与 `src/ui/palette.ts`。

### Don't
- **Don't** 加阴影、渐变、齿孔、印章、贴纸、倾斜文字——上一版的集邮世界已经收起来了。
- **Don't** 在首页重新放两个输入框，也不要给保存单独开一张卡。
- **Don't** 用颜色单独表达状态；没有形状差异就不算状态。
- **Don't** 给列表加卡片底、缩略图、箭头——一行就是一条内容。
- **Don't** 手写 `StyleSheet` 或 `makeStyles`：样式一律走 `className`，只有原生 prop 需要的字符串才用 `usePalette()`。
