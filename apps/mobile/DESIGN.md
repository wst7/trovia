---
name: Trovia Mobile
description: 记忆切片 —— 真白底、系统黑体、一个朱红动作、60×76 的识别封面
colors:
  canvas: "#fafaf7"
  surface: "#ffffff"
  sunken: "#f2f1eb"
  line: "#e4e2d9"
  line-strong: "#d2cfc4"
  ink: "#14130f"
  muted: "#56524a"
  faint: "#6f6a60"
  accent: "#c1371c"
  accent-quiet: "#fcede7"
  danger: "#b3261e"
  warn: "#8a5a20"
  ok: "#1f6b45"
typography:
  display: "31px / 40px / 600 / -0.87px"
  title: "26px / 35px / 600 / -0.57px"
  read: "17px / 30px / 400 / -0.09px"
  heading: "18px / 26px / 600 / -0.22px"
  body: "16px / 25px / 400 / 0"
  body-sm: "14.5px / 23px / 400 / 0"
  caption: "12.5px / 18px / 400 / +0.01em"
  label: "12px / 16px / 600 / +0.96px"
  mono: "12px / 18px / Menlo / 0"
rounded:
  chip: "10px"
  thumb: "10px"
  field: "15px"
  card: "16px"
  button: "14px"
  full: "999px"
spacing:
  gutter: "20px"
  topbar: "52px"
  tabbar: "50px + safe area"
  row: "102px (60×76 cover + 13px above/below)"
components:
  search:
    height: "56px"
    radius: "{rounded.field}"
  button-primary:
    background: "{colors.accent}"
    text: "{colors.surface}"
    height: "50px"
    radius: "{rounded.button}"
  ask-card:
    background: "{colors.sunken}"
    radius: "14px"
  answer-card:
    background: "{colors.surface}"
    border: "1px {colors.line}"
    radius: "{rounded.card}"
  library-row:
    cover: "60×76, radius 10px"
    title: "16.5px / 24px / 600"
    meta: "12.5px"
---

# Design System: Trovia Mobile

## Overview

**Creative North Star: 「记忆切片」**

界面不再模拟纸张的米黄，而是用真白底和深墨字先把对比立住；全站只用一个系统黑体，不打包字体。字号整体上调：最小 11.5，正文 16，阅读正文 17/30，列表标题 17。层级由字号、字重和间距承担，不再靠 9–10px 的小字撑版式。

四条可检查的规则：

1. **一个屏幕只有一个朱红动作。** 朱红只给「现在能做的那一件事」：首页搜索箭头、详情「打开原文」、问模型答案卡上的标记。其余全屏无彩。
2. **一行就是一条内容。** 收藏与最近收藏用 60×76 封面帮眼睛认路，不包卡片、不加箭头；分组的收束是一条实线 + 12 号字距标签。
3. **搜索结果先给你记得的那一句。** 标题、出处之后立刻是真实命中句的浅灰引用块，最后才是「为什么算命中」。
4. **状态用形状，也带文字。** 实心极淡点＝已完成（安静，不抢眼）；空心＝整理中；实心 warn＝只读到部分；实心 danger＝没读完。颜色不是唯一线索。

技术实现是 **NativeWind 4（Tailwind 3.4 / react-native-css-interop）**：颜色走 `global.css` 的 CSS 变量，明暗随系统切换；原生 prop 需要字符串时走 `src/ui/palette.ts`。两份值必须同步改。封面占位的六种色也在 `palette.ts` 的 `tileFor()` 里。

## Colors

| 角色 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| canvas | `#fafaf7` | `#0d0c0a` | 页面底、导航栏底 |
| surface | `#ffffff` | `#171614` | 抬起的表面：搜索框、答案卡、设置组 |
| sunken | `#f2f1eb` | `#201f1b` | 浅灰气泡、引用块、未就绪按钮、图标底 |
| line | `#e4e2d9` | `#2c2a25` | 发丝线、分隔、描边 |
| line-strong | `#d2cfc4` | `#3c3931` | 聚焦描边、可交互描边 |
| ink | `#14130f` | `#f6f2e9` | 主文字 |
| muted | `#56524a` | `#b7b2a6` | 次要文字、引用正文 |
| faint | `#6f6a60` | `#9a9488` | 栏目名、时间、占位符 |
| accent | `#c1371c` | `#ff6c4c` | 唯一强调色 |
| accent-quiet | `#fcede7` | `#2b1913` | 强调色的淡底 |
| danger | `#b3261e` | `#f07362` | 删除、失败 |
| warn | `#8a5a20` | `#d8a35f` | 部分成功 |
| ok | `#1f6b45` | `#63b98a` | 校验通过的勾 |

**The One-Accent Rule.** 一屏只能有一个朱红动作。两处朱红＝没有重点。

**The Paired-Sync Rule.** `global.css` 与 `src/ui/palette.ts` 是同一份颜色的两种写法，永远一起改。

## Typography

**字体：系统黑体。** iOS 苹方 / Android Noto Sans CJK；没有字体包。

| 档位 | 尺寸 | 用途 |
| --- | --- | --- |
| display | 31/40/600 | 首页「想找点什么？」 |
| title | 26/35/600 | 页面标题、详情标题 |
| heading | 18/26/600 | 小节标题 |
| body | 16/25 | 界面正文、输入 |
| read | 17/30 | 详情正文 |
| body-sm | 14.5/23 | 说明、副标题 |
| caption | 12.5/18 | 出处、时间、辅助 |
| label | 12/16/600/+0.96 | 栏目名（`uppercase`） |
| mono | 12/18 | 代码、数字 |

栏目名统一 `text-label uppercase text-faint`。中文大字号用负字距（-0.57 / -0.87），正文 0，只有 label 带正字距。

## Layout

单栏，基准 390×844。页面 gutter **20dp**；顶部标题行 52dp；底部导航 50dp + 安全区。内容为导航留出 `insets.bottom + 58 + 24`。

**首页三段式**：品牌行（左 Trovia，右总篇数）→ label + display + 一句说明 → 56dp 搜索框 → 统计行 → 「问模型」入口卡 → 猜你想找 → 最近收藏。搜索后搜索框留在原处，下面换成结果。

**收藏页**：标题行 → 48dp 填充搜索框 → 33dp 筛选 chips（按日期 / 按站点 / 没读完 / 只看导入）→ 分组标签 + 实线 → 102dp 行。分组用 12 号字距标签 + 一条实线，不再做双线或左轨。

**详情页**：有封面时先给 260dp 全宽图；然后出处行（站点 · 日期 · 保存时间）、26 号标题；命中句（从搜索进入时）放在浅灰卡里；再接摘要、关键词、原文、相关。底部固定「打开原文」+ 分享。

**问模型**：问题在浅灰气泡（右下角 6dp），工具过程压成一行（勾 + 「查了 N 篇 · 检索 N 条」），回答在白卡里，出处带 38×48 封面，输入框固定在底部 50dp 盒子里。

**我的**：顶部标题 + 「本机 · 无需账号」；三格 statcard（篇收藏 / 可搜索 / 整理中）；之后是 16dp 圆角 surface 组。

## Components

### Buttons
- **Primary**：朱红底、白字（暗色下 `onAccent` 深字）、50dp 高、14dp 圆角。
- **Secondary**：surface 底 + `line` 1px 描边、ink 字。
- **Quiet**：纯文字，accent / danger；44dp 触区。
- **IconButton**：48dp 触区，无底色。

### Search / Composer
首页唯一的输入面：56dp 高、15dp 圆角、`surface` 底 + `line` 描边；左放大镜 19，右 38dp 方块提交键（未就绪 `sunken`，就绪朱红）。有内容时出现 26dp 圆形清除键。识别到链接时提交键图标是书签，否则是向上箭头。收藏页筛选框：48dp 高、12dp 圆角、`sunken` 填充、无描边。

### List rows
- **RecentRow**：60×76 封面（文章首图铺满；无图时六种 tile 色 + 22 号首字母）；标题 16.5/24/600，最多两行；元信息 12.5（域名 · 日期）；右侧状态。上下 13dp，行高约 102。
- **ResultRow**：同样的封面与标题；标题下是 12.5 出处；然后 `sunken` 引用块（12dp 圆角、左侧 2dp 朱红、14.5/24、最多两行）；最后 12 号 `match_reason`。搜索词用 accent 加粗标出。
- **多选**：勾选圈原地替换封面，左列不位移。

### Ask
- 问题气泡：`sunken` 底、16dp 圆角、右下 6dp 角；11.5 号「你问的」+ 16/26 问题。
- 过程：一行 12.5 号 faint，勾 14dp `ok`。
- 回答卡：`surface` 底、1px `line`、16dp 圆角；头部 20dp 朱红方块 + sparkles + 「回答」，右侧「复制」；正文 15.5/27。
- 出处：38×48 封面 + 14/20 标题 + 11.5 站点 · 日期；行间 1px 线。
- 底部 dock：50dp 盒子、14dp 圆角、34dp 方形发送键；运行中变黑色停止键。

### Detail
- 封面 260dp 全宽；标题 26/35；出处 12.5。
- 命中句卡：`sunken`、14dp 圆角、15/26、最多三行，label 带 accent 时钟。
- 摘要：label + 16/29 正文；关键词 32dp 高、9dp 圆角、`sunken` chips。
- 原文：17/30；超过 1200 字仍默认收起，给三行纯文本预览。
- 底部动作条：primary 「打开原文」flex-1 + 50dp 方形分享 ghost。

### Settings
- statcard：surface 底、16dp 圆角、三格，数字 26/32/600，标签 11.5 faint。
- 组：surface 底、16dp 圆角、1px line，行内 1px 分隔；图标 32dp `sunken` 方块；标题 15/21/600，副标题 12.5 faint，右侧值 13 faint。
- 选择行用 radio，不再给 chevron；chevron 只表示「进入下一屏」。

### Navigation
底部通栏、`canvas` 底、顶部 1px 线。图标 23dp + 10px 标签；选中 ink，未选 faint。

### 其他
- **Markdown**：标题、段落（17/30）、列表、引用（左 2px line）、代码块（`sunken`）、行内代码、链接（accent + 下划线）。永不 WebView、永不注入 HTML。
- **Ask 正文**使用 `compact` Markdown：15.5/27。
- **图片**：详情最多四张单列，8dp 圆角；图片 OCR 文本接在原文末尾 `## 图片文字`。
- **ConfirmDialog / Toast**：沿用旧结构，颜色换到本表。
- **StatusMark**：6dp 点；completed 用 `faint` 40% 透明，无文字；pending 空心；partial warn；failed danger。

## Do's and Don'ts

### Do
- **Do** 一屏只有一个朱红动作；层次用字号、字重、留白。
- **Do** 用 1px 发丝线分隔，gutter 20dp，触区 ≥44dp（图标 48dp）。
- **Do** 搜索结果里放真实命中的那一句，只用真实证据。
- **Do** 首页搜索框不动；结果替换在它下面。
- **Do** 收藏页用 60×76 封面 + 分组标签 + 实线，不用左轨双线。
- **Do** 原生 prop 的字符串颜色从 `usePalette()` 取；改色同步 `global.css` 与 `palette.ts`。

### Don't
- **Don't** 引入第二个字体、第二个色相、渐变、齿孔、印章、贴纸、倾斜文字。
- **Don't** 给列表加卡片底、缩略图之外的装饰或箭头。
- **Don't** 用颜色单独表达状态；没有形状差异就不算状态。
- **Don't** 在首页重新放两个输入框，也不要给保存单独开一张卡。
- **Don't** 手写 `StyleSheet`/`makeStyles`：样式一律 `className`，只有原生 prop 需要字符串时才用 `usePalette()`。
