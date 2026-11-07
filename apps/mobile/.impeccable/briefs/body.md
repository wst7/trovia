# Trovia Android · 集邮册与销戳

## Scope and mode

Scope: `apps/mobile` 全部五个屏幕（首页 / 收藏 / 详情 / 我的 / 分享）与共享组件。Mode: operate——Material 3 管结构、导航与交互，世界只出四样：字、色、密度、一个签名动作。本机优先、无账号、搜索优先的产品真相不动。

## Direction contract

**THESIS:** 每篇收藏是一枚被销戳的邮票——保存的那天，邮戳就盖在它身上，找回就是从集邮册里认出那枚戳。拒绝的品类默认：白底圆角卡片流 + 中性强调色的「稍后读」列表，把收藏当成无差别的行。

**OWN-WORLD:** 胶面纸底 `#f3ede0`（暗色：深绿集邮册布 `#1c2422`），邮戳紫黑 `#2e2742` 为主墨色，票面朱红 `#c2402c` 承担 primary/强调，集邮绿 `#35564a` 为 tertiary 容器色。组件语言＝齿孔边（头像与卡片的打孔边缘）、圆形邮戳（日期＋状态压在票面右上）、票面分段细线、账簿式表格数字。字：系统字族，标签走 tracked 小型大写式全大写拉丁＋中文小标签，数字一律 tabular。

**STORY:** 用户打开首页，看到的是一本正在用的集邮册：贴一条链接＝寄一封信，收藏页＝一页贴满邮票的册页，状态是戳的形状（实圈＝完成、虚圈＝整理中、划销＝失败），搜索命中理由像销戳旁的注记。他相信：每条内容都有出处、有日期、有经手痕迹。

**FIRST VIEWPORT:** 390×844。顶部品牌行（邮票形品牌标＋「Trovia」＋「仅本机」chip）；之下英雄句「今天想找点什么？」；主体两块——找回（搜索胶囊，聚焦描朱红）与收藏（贴票输入卡，保存按钮是 40dp 朱红圆），各占约 112/140dp；底部 80dp Material NavigationBar，选中项 secondaryContainer 胶囊。销戳出现在结果票的右上角。

**FORM:** 替换式世界，代码优先（code-led Operate），不走 comp。签名动作＝保存完成瞬间，圆形邮戳（日期环＋锯齿边）压上票面右上角并微微转角；状态变更用戳的形，不用色。seed:977254989eb41b57

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 锯齿邮戳用纯 View/CSS 绘制（项目无 react-native-svg）；若视觉不够，退回双同心圆＋齿边点阵。
- 详情页摘要块从 primaryContainer 换成票面底＋朱红栏头，待评审确认。
