---
version: 1
slug: "apps-mobile"
primary_target: "apps/mobile"
related_targets: []
---

# Trovia Android · 集邮册与销戳

## Scope and mode

Scope: `apps/mobile` 全部五个屏幕（首页 / 收藏 / 详情 / 我的 / 分享）与共享组件。Mode: operate——Material 3 管结构、导航与交互，世界只出四样：字、色、密度、一个签名动作。本机优先、无账号、搜索优先的产品真相不动。

## Direction contract

**THESIS:** 每篇收藏是一枚被销戳的邮票——保存的那天，邮戳就盖在它身上，找回就是从集邮册里认出那枚戳。拒绝的品类默认：白底圆角卡片流 + 中性强调色的「稍后读」列表，把收藏当成无差别的行。

**OWN-WORLD:** 胶面纸底 `#f3ede0`（暗色：深绿集邮册布 `#1c2422`），邮戳紫黑 `#2e2742` 为主墨色，票面朱红 `#c2402c` 承担 primary/强调，集邮绿 `#35564a` 为 tertiary 容器色。组件语言＝齿孔边（头像与卡片的打孔边缘）、圆形邮戳（日期＋状态压在票面右上）、票面分段细线、账簿式表格数字。字：系统字族，标签走 tracked 小型大写式全大写拉丁＋中文小标签，数字一律 tabular。

**STORY:** 用户打开首页，看到的是一本正在用的集邮册：贴一条链接＝寄一封信，收藏页＝一页贴满邮票的册页，状态是戳的形状（实圈＝完成、虚圈＝整理中、划销＝失败），搜索命中理由像销戳旁的注记。他相信：每条内容都有出处、有日期、有经手痕迹。

**FIRST VIEWPORT:** 390×844。顶部品牌行（邮票形品牌标＋「Trovia」＋「仅本机」chip）；之下英雄句「今天想找点什么？」；主体两块——找回（搜索胶囊，聚焦描朱红）与收藏（贴票输入卡，头行下发丝分段线，保存按钮是 40dp 朱红圆），各占约 112/140dp；底部 80dp Material NavigationBar，选中项 secondaryContainer 胶囊。结果票上，销戳坐在底部注记段右侧、与「为什么找到它」并排（与 STORY 的「销戳旁的注记」一致；保存票的收据戳则压在票面右上角）。

**FORM:** 替换式世界，代码优先（code-led Operate），不走 comp。签名动作＝保存完成瞬间，圆形邮戳（日期环＋锯齿边）压上票面右上角并微微转角；状态变更用戳的形，不用色。seed:977254989eb41b57

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- ~~锯齿邮戳用纯 View/CSS 绘制~~ — 已实现并经 finish review 像素验证（双同心圆＋日期等宽数字＋划销线；旋转 −8° 实测 −6.7/−7.0°）。项目无 react-native-svg，保持 View 方案。
- ~~详情页摘要块换票面底＋朱红栏头~~ — 已实现并经评审通过；正文块已补同构「原文」栏头。
- **平台遮罩偏差（记录）**：启动页 splash 图标已打真齿孔（44 孔，DstOut 打穿，透出底色）；但 Android 自适应启动器图标受各家 launcher 遮罩（圆/方/水滴）裁切，齿孔贴边必被切碎，故 launcher 图标保留无齿孔的朱红圆角方块＋白书签——齿孔语言只在应用内（品牌标、邮票头像、空状态）与 splash 呈现。iOS 图标同样无齿孔（系统 squircle 遮罩同理）。
