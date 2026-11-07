# Trovia

[![Latest release](https://img.shields.io/github/v/release/wst7/trovia?sort=semver)](https://github.com/wst7/trovia/releases/latest)
[![Android build](https://github.com/wst7/trovia/actions/workflows/android.yml/badge.svg)](https://github.com/wst7/trovia/actions/workflows/android.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-1A1917)](LICENSE)

**English** · [中文](README.zh-CN.md)

Save a link. Months later, describe what you remember and get it back.

[Download for Android](https://github.com/wst7/trovia/releases/latest) · [Landing page](https://wst7.github.io/trovia/?lang=en)

<p align="center">
  <img src="docs/screenshots/home.png" width="31%" alt="One input: paste a link, or describe what you remember" />
  <img src="docs/screenshots/search.png" width="31%" alt="Results say where they matched" />
  <img src="docs/screenshots/article.png" width="31%" alt="The article, kept on the phone" />
</p>

## What it does

- **Save** — paste, share from another app, or catch a link on the clipboard. Bookmarks, CSV and plain lists import in one step.
- **Read** — fetches the text, keeps the images, reads the words inside them, writes a summary and keywords.
- **Find** — a sentence, a keyword or a time range. Every result says why it matched.
- **Sync** — your own WebDAV. Two devices editing one item leaves a conflict copy, never a silent overwrite.
- **Leave** — one `.zip`, a field-for-field backup plus Markdown. Nothing is locked in.

Text, images and index stay on the phone. An optional OpenAI-compatible model writes summaries and reads search intent; without one, summaries are extracted offline.

## Install

Download `trovia-*-arm64.apk` from [Releases](https://github.com/wst7/trovia/releases/latest). It is signed with a debug key: fine for installing yourself, not for publishing. iPhone needs Xcode or EAS.

The app checks GitHub for a newer release and installs it in place; JS-only fixes arrive as hot updates and need no download.

## Where it stops

WeChat, Juejin, SSPAI, CSDN, V2EX, GitHub and Wikipedia are read in full. Zhihu, Medium, Douban and 36Kr sit behind a sign-in or a bot check, so only the link and title are kept. Video keeps the title and description, no subtitles.

## Build

```bash
npm install && npm run dev:mobile

cd apps/mobile && npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -x lint -x test
```

`npm test -w @trovia/mobile` and `npm test -w @trovia/sync` cover query parsing, migrations, the sync engine and the WebDAV adapter. Before a tag, `npm run smoke -w @trovia/mobile` runs the site list above through the same parser the app uses.

Product scope: [`docs/PRODUCT.md`](docs/PRODUCT.md). Conventions: [`docs/ENGINEERING.md`](docs/ENGINEERING.md). Changes: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## License

AGPL-3.0, see [LICENSE](LICENSE). Fork it, change it, run it; shipping it or hosting it as a service means your version stays open too. The Trovia name and logo are not covered.
