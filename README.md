# Trovia · 寻迹

**你不需要记住收藏了什么，只需要记住你想找什么。**

把链接丢进来，它读完、整理好、存在你自己手机上；以后用一句模糊的描述就能翻回来。

[下载 Android 版](https://github.com/wst7/xunji/releases/latest) · [看看它长什么样](https://wst7.github.io/xunji/)

## 能做什么

- **存**：粘贴链接、系统分享，或打开应用时剪贴板里的链接；也能把浏览器书签、CSV、链接清单一次性搬进来。
- **整**：抓正文、存正文图片、读图上的文字、写摘要和关键词。
- **找**：整句描述、关键词、时间都能搜——「找找昨天的」「2022年发表的」也算，结果会标出为什么命中。
- **本机**：不登录、不上传，断网也能翻已经存下的内容——正文图片会一起存到手机上。
- **带走**：任何时候都能完整导出（一份 JSON 给机器读，一份 Markdown 给人看），不锁定在你这里。

## 大模型（可选）

配一个 OpenAI 兼容服务（OpenAI、OpenRouter、硅基流动、Ollama、LM Studio…），摘要把内容交给它；配上后搜索时也把那一句查询发给它理解。不配就用离线抽取，功能不缺。Key 只进系统钥匙串。

## 安装

**Android**：到 [Releases](https://github.com/wst7/xunji/releases/latest) 下载 `xunji-*-arm64.apk`。调试密钥签名，自己装没问题，上架不行。

**iPhone**：没有现成安装包，需要 Xcode 或 EAS 自建。

## 它的边界

微信公众号、掘金、少数派、CSDN 这类能读全文；知乎、Medium、豆瓣、36 氪有登录墙或人机验证，只存链接。视频只存标题和简介，不做字幕。

## 开发

```bash
npm install && npm run dev:mobile   # 手机 App（Expo）
docker compose up --build       # 网页版 + API + Worker（自托管）
```

产品边界见 [`docs/PRODUCT.md`](docs/PRODUCT.md)，接口与数据库约定见 [`docs/ENGINEERING.md`](docs/ENGINEERING.md)。
