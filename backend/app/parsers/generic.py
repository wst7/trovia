"""通用网页解析：OG/JSON-LD 元数据 + trafilatura 正文（bs4 兜底）。"""
from __future__ import annotations

import re

import trafilatura

from app.fetch import FetchResult
from app.logging import get_logger
from app.parsers.base import (
    ParseResult,
    absolute_urls,
    clean_text,
    first_json_ld,
    host_of,
    make_soup,
    meta_content,
    parse_datetime,
)

logger = get_logger("trovia.parsers.generic")

_ARTICLE_JSON_LD = {"Article", "NewsArticle", "BlogPosting", "WebPage", "TechArticle"}

_MD_LINK_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MD_URL_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def _markdown_to_plain(markdown: str) -> str:
    """粗略去掉 Markdown 标记，得到可检索的纯文本。"""
    text = markdown
    text = re.sub(r"```[a-zA-Z0-9_-]*\n?", "", text)
    text = text.replace("```", "")
    text = _MD_LINK_RE.sub(r"\1", text)
    text = _MD_URL_RE.sub(r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.M)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    text = re.sub(r"(\*|_)(.*?)\1", r"\2", text)
    text = re.sub(r"^\s*([-*_])\s*(\1\s*)+$", "", text, flags=re.M)
    return text.strip()


def _bs4_extract(soup) -> str | None:
    """bs4 正文兜底：去掉脚本与站点框架后按块取文本。"""
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe", "svg"]):
        tag.decompose()
    root = soup.body or soup
    blocks: list[str] = []
    for el in root.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "pre", "td"]):
        if el.name in {"p", "td"} and el.find_parent(["li", "td", "blockquote", "pre"]):
            continue  # the block-level parent already covers it, so avoid duplication
        text = clean_text(el.get_text(" ", strip=True))
        if text:
            blocks.append(text)
    if not blocks:
        text = clean_text(root.get_text("\n", strip=True))
        return text
    # De-duplicate adjacent repeated blocks (common with nested containers)
    deduped: list[str] = []
    for block in blocks:
        if not deduped or deduped[-1] != block:
            deduped.append(block)
    return "\n\n".join(deduped) or None


def _collect_images(soup, base_url: str) -> list[str]:
    urls: list[str] = []
    og_image = meta_content(soup, "og:image", "twitter:image")
    if og_image:
        urls.append(og_image)
    root = soup.body or soup
    for img in root.find_all("img"):
        src = img.get("data-src") or img.get("data-original") or img.get("src")
        if src:
            urls.append(src)
        if len(urls) >= 20:
            break
    return absolute_urls(base_url, urls, limit=20)


def _collect_links(soup, base_url: str) -> list[str]:
    root = soup.find("article") or soup.find("main") or soup.body or soup
    hrefs = [a.get("href") for a in root.find_all("a", href=True)]
    return absolute_urls(base_url, [h for h in hrefs if h], limit=50)


def _json_ld_author(entry: dict) -> str | None:
    author = entry.get("author")
    if isinstance(author, dict):
        return clean_text(str(author.get("name") or ""))
    if isinstance(author, list):
        names = [clean_text(str(a.get("name") or "")) for a in author if isinstance(a, dict)]
        names = [n for n in names if n]
        return ", ".join(names) if names else None
    if isinstance(author, str):
        return clean_text(author)
    return None


class GenericParser:
    name = "generic"

    def matches(self, url: str, source_type: str) -> bool:
        return True

    def parse(self, fetched: FetchResult) -> ParseResult:
        try:
            return self._parse(fetched)
        except Exception as exc:  # a parser defect must not crash the job; turn it into a failed result
            logger.exception("generic_parse_error", extra={"url": fetched.url})
            return ParseResult(
                source_type="web",
                original_url=fetched.url,
                canonical_url=fetched.final_url or fetched.url,
                parse_status="failed",
                error_code="PARSE_ERROR",
                error_message=f"页面解析出错：{exc.__class__.__name__}",
                metadata={"parser": self.name},
            )

    def _parse(self, fetched: FetchResult) -> ParseResult:
        soup = make_soup(fetched.text)
        base_url = fetched.final_url or fetched.url
        json_ld = first_json_ld(soup, _ARTICLE_JSON_LD) or {}

        title = (
            meta_content(soup, "og:title", "twitter:title")
            or clean_text(soup.title.get_text() if soup.title else None)
            or clean_text(json_ld.get("headline"))
        )
        description = (
            meta_content(soup, "og:description", "twitter:description", "description")
            or clean_text(json_ld.get("description"))
        )
        author = (
            meta_content(soup, "author", "article:author")
            or _json_ld_author(json_ld)
        )
        published_raw = (
            meta_content(soup, "article:published_time", "published_time", "pubdate")
            or json_ld.get("datePublished")
        )
        published_at = parse_datetime(published_raw if isinstance(published_raw, str) else None)
        site_name = meta_content(soup, "og:site_name") or host_of(base_url)
        language = (
            (soup.html.get("lang") if soup.html else None)
            or meta_content(soup, "og:locale")
        )
        language = clean_text(language)

        content_markdown = None
        try:
            content_markdown = clean_text(
                trafilatura.extract(
                    fetched.text,
                    output_format="markdown",
                    include_comments=False,
                    include_tables=True,
                )
            )
        except Exception:  # trafilatura can raise on malformed HTML → take the fallback
            content_markdown = None
        plain_text = _markdown_to_plain(content_markdown) if content_markdown else None
        if not plain_text:
            plain_text = _bs4_extract(soup)
            if plain_text:
                content_markdown = plain_text  # the fallback degrades to plain-text paragraphs

        images = _collect_images(soup, base_url)
        links = _collect_links(soup, base_url)

        metadata: dict = {"parser": self.name, "images": images, "links": links}
        if json_ld:
            metadata["json_ld_type"] = json_ld.get("@type")

        if plain_text:
            status, code, message = "completed", None, None
        elif title or description:
            status = "partial"
            code = "CONTENT_NOT_FOUND"
            message = "未能从页面中提取正文，仅保存了标题与元数据。"
        else:
            status = "failed"
            code = "CONTENT_NOT_FOUND"
            message = "页面中没有可识别的内容。"

        return ParseResult(
            source_type="web",
            original_url=fetched.url,
            canonical_url=base_url,
            title=title,
            author=author,
            published_at=published_at,
            site_name=site_name,
            description=description,
            content_markdown=content_markdown if plain_text else None,
            plain_text=plain_text,
            images=images,
            links=links,
            language=language,
            parse_status=status,
            error_code=code,
            error_message=message,
            metadata=metadata,
        )
