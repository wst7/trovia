# 竞品差评调研

2026-11-01。样本来自四个可程序化获取的渠道，避免只看官方宣传：

| 渠道 | 拿到了什么 |
|---|---|
| App Store 评论 RSS（cn/us） | 548 条评论，其中 1–3 星 230 条：Cubox 100+48、Readwise Reader 100、Raindrop 100、mymind 100、Instapaper 100 |
| GitHub Issues API | karakeep 5、linkwarden 12、omnivore 8 条 open issue（按评论数排序） |
| V2EX | 「求一款稍后读 App」讨论帖，19 条回复 |
| Hacker News | Readwise 定价讨论、Karakeep 自托管讨论 |

Reddit 直连与代理均返回 403（服务端按 IP 拦截），本次没有采到；如需补齐，可换住宅 IP 或用 redlib 实例。

## 一、痛点排序（按 1–3 星评论命中数）

| 痛点 | 条数 | 分布 |
|---|---|---|
| AI 不准 / 胡编 | 54 | Raindrop 16、Cubox 13、Readwise 12、Instapaper 11 |
| 价格 / 订阅 | 46 | Cubox 14、Instapaper 12、Readwise 9、Raindrop 6 |
| 卡顿 / 崩溃 / 慢 | 41 | Readwise 11、Instapaper 9、Cubox 7、Raindrop 7 |
| 界面 / 易用性 | 38 | Instapaper 10、Raindrop 9、mymind 9、Cubox 7 |
| 搜不到 / 检索差 | 24 | Raindrop 8、Cubox 7 |
| 登录 / 账号问题 | 21 | Cubox 12 |
| 中文 / 国内站点支持 | 14 | **全部是 Cubox** |
| 数据丢失 / 内容消失 | 13 | Instapaper 5、Raindrop 3、Cubox 2 |

## 二、原话（按主题）

**1. 功能被砍，付费用户的信任先崩**

- 「作为付费用户已经用了快三年，今天一更新发现文件和文本剪藏都砍了，仅仅剩下链接剪藏，纯纯的负优化」（Cubox 1★）
- 「凭什么去掉图片收藏和文件收藏」（Cubox 1★）
- 「将文字速记这样非常重要的功能直接砍掉…用户付了费用，但使用的产品也损失了现有的功能」（Cubox 1★）
- 「嵌套标签更新后从免费变成了付费功能」（Cubox 1★）

**2. AI 差，但收费不便宜**

- 「AI 能力奇差，还收这么高额的费用…完全是蹭热点，包装出来收费」（Cubox 1★）
- 「AI 能力太太太垃圾了，我建议做不明白的话直接接一下好一点的模型，让用户自己写提示词，你把上下文工程做好就行了」（Cubox 1★）
- 「A lite tier that's only the Reader app would be great. I'm exploring self hosted options… due to the price being a little hard to justify」（HN，Readwise）

**3. 中文站点存不进去**

- 「抖音小红书试了都不好用，抖音的链接打不开，小红书根本收藏不进去」（Cubox 1★）

**4. 想把数据放在自己的云盘**

- 「希望支持将内容缓存备份到本地，或者云盘中，不然原内容丢失了，我们这边的也会丢失」（Cubox 3★）
- V2EX 求推荐帖的原话：「希望有 MacOS 端和 Android 端，可以通过第三方网盘同步，包括但不限于 OneDrive、iCloud 等，WebDAV 服务也包含在内。其实 Readwise 挺好，但是一个月 8 美刀，真的太贵了」

**5. 稍后读最大的敌人不是竞品，是吃灰**

- V2EX：「稍候读就等同于吃灰」「我之前用 pocket 存了一堆，结果直到我不再使用这个 app，都没看完」

## 三、对寻迹的判断

1. **「本地 + 自带云盘」不是小众洁癖，是真实需求**：V2EX 那条求推荐把 OneDrive/iCloud/WebDAV 写在需求第一行，App Store 评论里也有人主动要求备份到自己的云盘。我们的 WebDAV 路线方向正确，应该继续做。
2. **「功能被砍」是这批产品最伤的地方**：用户能接受产品小，不能接受已付费的东西消失。本地优先 + 永远可导出，本身就是卖点，要写在明面上。
3. **中文站点抽取是被验证的空白**：小红书、抖音、公众号存不进去，竞品用户直接骂。这是我们目前唯一别人短期抄不走的能力。
4. **「吃灰」问题正是我们的差异点**：他们卖「稍后读」，我们卖「找得回来」——存的目的是取回，不是攒着。

## 四、定价修正

原来建议 ¥98/年，看完评论后仍成立，但支持方式要改：

- **不按「功能墙」收费**：砍功能换钱是这批产品最大的反噬点。免费版保留全部本地能力（解析、OCR、时间与语义搜索、导出）。
- **只对「托管 AI」收费**：用户已经在为 AI 付费且不满意（54 条差评），说明需求真实、供给不足。
- **给一个可退的入口**：多个差评是「自动续费退不了」。年付必须能自助取消，这条比便宜 20 块更能换口碑。

## 五、复现方式

```bash
export HTTPS_PROXY=http://127.0.0.1:7897
npx tsx apps/mobile/scripts/collect-competitor-voice.mts   # 采集 → /tmp/competitor-voice.json
npx tsx apps/mobile/scripts/analyze-competitor-voice.mts   # 归类与统计
```
