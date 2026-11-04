"""GitHub 仓库页解析：og 元数据 + 渲染后 README 转 Markdown + 语言/stars。"""
from __future__ import annotations

import re

from bs4.element import NavigableString

from app.fetch import FetchResult
from app.logging import get_logger
from app.parsers.base import (
    ParseResult,
    clean_text,
    first_json_ld,
    make_soup,
    meta_content,
    parse_datetime,
)

logger = get_logger("trovia.parsers.github")

_NUMBER_RE = re.compile(r"^\s*([\d,.]+)\s*([kKmM]?)\s*$")


def _parse_count(value: str | None) -> int | None:
    """'12.5k' / '1,234' → int。"""
    text = (value or "").strip()
    if not text:
        return None
    match = _NUMBER_RE.match(text.replace(" ", " "))
    if not match:
        return None
    number = float(match.group(1).replace(",", ""))
    suffix = match.group(2).lower()
    if suffix == "k":
        number *= 1_000
    elif suffix == "m":
        number *= 1_000_000
    return int(number)


def _inline_markdown(node) -> str:
    """把行内元素渲染为 markdown 文本。"""
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, NavigableString):
            parts.append(str(child))
            continue
        name = child.name or ""
        if name == "a" and child.get("href"):
            text = _inline_markdown(child).strip()
            href = child["href"]
            parts.append(f"[{text}]({href})" if text else href)
        elif name == "img":
            alt = child.get("alt") or ""
            src = child.get("src") or ""
            parts.append(f"![{alt}]({src})" if src else "")
        elif name == "br":
            parts.append("\n")
        elif name == "code" and child.find_parent("pre") is None:
            parts.append(f"`{_inline_markdown(child).strip()}`")
        else:
            parts.append(_inline_markdown(child))
    return "".join(parts)


def _html_to_markdown(node) -> str:
    """渲染后的 HTML README → 近似 Markdown 文本。"""
    blocks: list[str] = []
    for el in node.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "blockquote", "hr"]):
        if el.name != "li" and el.find_parent(["li", "blockquote"]):
            continue  # 文本已由外层列表项/引用块覆盖
        if el.name == "li" and el.find_parent("li"):
            continue  # 嵌套列表取最外层
        if el.name == "pre":
            code = el.get_text("", strip=False).strip("\n")
            blocks.append(f"```\n{code}\n```" if code else "")
            continue
        if el.name == "hr":
            blocks.append("---")
            continue
        level = int(el.name[1]) if el.name.startswith("h") and el.name[1:].isdigit() else 0
        text = clean_text(_inline_markdown(el))
        if not text:
            continue
        if level:
            blocks.append(f"{'#' * level} {text}")
        elif el.name == "blockquote":
            blocks.append("\n".join(f"> {line}" for line in text.split("\n")))
        elif el.name == "li":
            blocks.append(f"- {text}")
        else:
            blocks.append(text)
    deduped: list[str] = []
    for block in blocks:
        if not deduped or deduped[-1] != block:
            deduped.append(block)
    return "\n\n".join(deduped).strip() or None


class GithubParser:
    name = "github"

    def matches(self, url: str, source_type: str) -> bool:
        return source_type == "github"

    def parse(self, fetched: FetchResult) -> ParseResult:
        try:
            return self._parse(fetched)
        except Exception as exc:
            logger.exception("github_parse_error", extra={"url": fetched.url})
            return ParseResult(
                source_type="github",
                original_url=fetched.url,
                canonical_url=fetched.final_url or fetched.url,
                parse_status="failed",
                error_code="PARSE_ERROR",
                error_message=f"GitHub 页面解析出错：{exc.__class__.__name__}",
                metadata={"parser": self.name},
            )

    def _parse(self, fetched: FetchResult) -> ParseResult:
        soup = make_soup(fetched.text)
        base_url = fetched.final_url or fetched.url
        json_ld = first_json_ld(soup, {"SoftwareSourceCode", "WebPage"}) or {}

        title = (
            meta_content(soup, "og:title", "twitter:title")
            or clean_text(soup.title.get_text() if soup.title else None)
        )
        description = (
            meta_content(soup, "og:description", "twitter:description", "description")
            or clean_text(json_ld.get("description"))
        )
        author = None
        if title and "/" in title:
            author = clean_text(title.split("/", 1)[0])

        readme_node = soup.select_one("article.markdown-body") or soup.select_one(
            ".markdown-body"
        )
        content_markdown = _html_to_markdown(readme_node) if readme_node else None
        plain_text = None
        if content_markdown:
            plain_text = re.sub(r"[#*`>]+", " ", content_markdown)
            plain_text = re.sub(r"\[(.*?)\]\([^)]*\)", r"\1", plain_text)
            plain_text = clean_text(re.sub(r"^\s*-\s+", "", plain_text, flags=re.M))

        stars_node = soup.select_one("#repo-stars-counter-star")
        stars = _parse_count(
            stars_node.get("title") if stars_node else None
        ) or _parse_count(stars_node.get_text(strip=True) if stars_node else None)
        forks_node = soup.select_one("#repo-network-count")
        forks = _parse_count(
            forks_node.get("title") if forks_node else None
        ) or _parse_count(forks_node.get_text(strip=True) if forks_node else None)
        language_node = soup.select_one('[itemprop="programmingLanguage"]')
        repo_language = clean_text(language_node.get_text(strip=True) if language_node else None)

        published_at = None
        time_node = soup.select_one("relative-time[datetime]")
        if time_node is not None:
            published_at = parse_datetime(time_node.get("datetime"))

        site_name = meta_content(soup, "og:site_name") or "GitHub"
        language = clean_text(soup.html.get("lang") if soup.html else None)

        metadata: dict = {
            "parser": self.name,
            "stars": stars,
            "forks": forks,
            "language": repo_language,
        }

        if plain_text:
            status, code, message = "completed", None, None
        elif title or description:
            status = "partial"
            code = "CONTENT_NOT_FOUND"
            message = "未能提取仓库 README，仅保存了仓库元数据。"
        else:
            status = "failed"
            code = "CONTENT_NOT_FOUND"
            message = "页面中没有可识别的仓库内容。"

        return ParseResult(
            source_type="github",
            original_url=fetched.url,
            canonical_url=base_url,
            title=title,
            author=author,
            published_at=published_at,
            site_name=site_name,
            description=description,
            content_markdown=content_markdown if plain_text else None,
            plain_text=plain_text,
            images=[],
            links=[],
            language=language,
            parse_status=status,
            error_code=code,
            error_message=message,
            metadata=metadata,
        )
