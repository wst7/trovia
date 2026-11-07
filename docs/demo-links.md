# 演示与截图用的固定链接

README、落地页、宣传素材里的截图，都只用这份清单里的链接。理由很实际：
之前截图用的是临时打开的标签页，过一阵没人记得那条是哪儿来的，也没法复现——
图里的标题、摘要、正文都对不上，看起来就像编的。

新增一条的要求：

1. 公开可访问、不需要登录，`npm run smoke` 能读通；
2. 内容长期稳定（别选首页、别选会滚动更新的列表页）；
3. 一条中文、一条英文各留几个，中英两版截图都用得上。

| 用途 | 链接 | 站点 | 备注 |
|---|---|---|---|
| 文章页主图 | https://sspai.com/post/73145 | 少数派 | 有图有列表，正文结构完整，适合展示排版 |
| 中文长文 | https://mp.weixin.qq.com/s/sgHX2VxtrNbyesXn-mzZqQ | 微信公众号 | 抓取最容易被问「能不能读」的站点 |
| 代码站 | https://github.com/facebook/react | GitHub | 展示非文章页的处理 |
| 技术长文 | https://martinfowler.com/articles/patterns-of-distributed-systems/ | Martin Fowler | 英文长文，适合英文版截图 |
| 百科 | https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture) | Wikipedia | 结构复杂、链接多，考验正文抽取 |
| 媒体 | https://www.bbc.com/news | BBC | 英文首页，仅用于列表/搜索演示 |
| 开发者社区 | https://juejin.cn/post/7433790333576822784 | 掘金 | 中文技术社区，图多 |

跑一遍确认都还能读：

```bash
cd apps/mobile && npm run smoke
```

`apps/mobile/scripts/smoke-parse.mts` 里的清单与本文件保持同步——两处凡是新增/删除站点，一起改。
