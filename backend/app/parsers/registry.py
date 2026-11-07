"""Parser registry: wechat > github > video > generic."""
from __future__ import annotations

from app.parsers.base import Parser
from app.parsers.generic import GenericParser
from app.parsers.github import GithubParser
from app.parsers.video import VideoParser
from app.parsers.wechat import WechatParser

_PARSER_CLASSES = (WechatParser, GithubParser, VideoParser, GenericParser)


def get_parser(url: str, source_type: str) -> Parser:
    """Return the first matching parser in priority order; generic is always the fallback."""
    for parser_class in _PARSER_CLASSES:
        parser = parser_class()
        if parser.matches(url, source_type):
            return parser
    return GenericParser()
