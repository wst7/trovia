# Trovia · 寻迹

[![最新版本](https://img.shields.io/github/v/release/wst7/trovia?sort=semver)](https://github.com/wst7/trovia/releases/latest)
[![Android 构建](https://github.com/wst7/trovia/actions/workflows/android.yml/badge.svg)](https://github.com/wst7/trovia/actions/workflows/android.yml)
![平台](https://img.shields.io/badge/平台-Android-3DDC84?logo=android&logoColor=white)
[![许可证](https://img.shields.io/badge/许可证-MIT-1A1917)](LICENSE)

**中文** · [English](README.md)

**你不需要记住收藏了什么，只需要记住你想找什么。**

把链接丢进来，它读完、整理好、存在你自己手机上；以后用一句模糊的描述就能翻回来。

[下载 Android 版](https://github.com/wst7/trovia/releases/latest) · [看看它长什么样](https://wst7.github.io/trovia/)

<p align="center">
  <img src="docs/screenshots/home.zh.png" width="31%" alt="一句话描述就能找回，也能直接粘链接" />
  <img src="docs/screenshots/search.zh.png" width="31%" alt="结果会说明为什么命中" />
  <img src="docs/screenshots/article.zh.png" width="31%" alt="正文留在手机里，断网也能读" />
</p>

## 能做什么

- **存**：粘贴链接、系统分享，或打开应用时剪贴板里的链接；也能把浏览器书签、CSV、链接清单一次性搬进来。
- **整**：抓正文、存正文图片、读图上的文字、写摘要和关键词。
- **找**：整句描述、关键词、时间都能搜——「找找昨天的」「2022年发表的」也算，结果会标出为什么命中。
- **本机**：不登录、不上传，断网也能翻已经存下的内容——正文图片会一起存到手机上。
- **带走**：任何时候都能完整导出成一个 `.zip`——里面是能逐字段还原的备份，外加一份 Markdown 给人看，不锁定在你这里。
- **更新**：应用内检查 GitHub 上的新版本并就地安装；只改界面和逻辑的更新走热更新，不用重装。
- **同步**：填自己的 WebDAV（坚果云、群晖、Nextcloud），内容直接进出你的网盘；两台设备都改过同一条时留一份「冲突副本」，不悄悄覆盖。

## 大模型（可选）

配一个 OpenAI 兼容服务（OpenAI、OpenRouter、硅基流动、Ollama、LM Studio…），摘要把内容交给它；配上后搜索时也把那一句查询发给它理解。不配就用离线抽取，功能不缺。Key 只进系统钥匙串。

## 安装

**Android**：到 [Releases](https://github.com/wst7/trovia/releases/latest) 下载 `trovia-*-arm64.apk`。调试密钥签名，自己装没问题，上架不行。

**iPhone**：没有现成安装包，需要 Xcode 或 EAS 自建。

## 它的边界

微信公众号、掘金、少数派、CSDN 这类能读全文；知乎、Medium、豆瓣、36 氪有登录墙或人机验证，只存链接。视频只存标题和简介，不做字幕。

## 从源码构建

需要 Node 22+、JDK 17，出 APK 还需要 Android SDK。

```bash
npm install

# 跑到连着的设备或模拟器上
npm run dev:mobile

# 出正式 APK（JS 打进包，模板 debug 密钥签名）
cd apps/mobile && npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -x lint -x test
```

测试与类型检查：

```bash
npm test -w @trovia/mobile      # 查询解析、输入框提示、库迁移、文案对齐
npm test -w @trovia/sync        # 同步引擎、WebDAV 适配、大库同步
cd apps/mobile && npx tsc --noEmit
```

## 发版前

`npm run smoke` 用 App 里同一份抓取代码跑一批真实站点（微信公众号、少数派、掘金、CSDN、GitHub、Martin Fowler，以及 Wikipedia、BBC、The Guardian、X 等），必选站点同时挂两个以上才拦发版——单个站点挂掉多半是它按来源 IP 变脸。

热更新随每个 tag 发布。`apps/mobile/app.config.ts` 里的 `runtimeVersion` 是手写常量（现在是 `native-1`），只有原生依赖、权限或包名变了才加一，并同时发一次 APK。

产品边界见 [`docs/PRODUCT.md`](docs/PRODUCT.md)，接口与数据库约定见 [`docs/ENGINEERING.md`](docs/ENGINEERING.md)，每个版本改了什么见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。随便用、随便改、随便发。
