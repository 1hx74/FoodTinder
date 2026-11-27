"""Ссылки на фото, аватар и гипертекст — относительные /api/db/..., без хоста."""
from urllib.parse import urlparse
import re

MEDIA_PREFIX = "/api/db/"

_HTML_ABS = re.compile(
    r"(?P<attr>src|href)=(?P<q>['\"])https?://[^/\"']+(?P<path>/api/db/[^\"']+)(?P=q)",
    re.IGNORECASE,
)


def to_public_media_url(value: str | None) -> str | None:
    """С наших медиа-ссылок снимает схему и хост; чужие URL не трогает."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return text
    if text.startswith(MEDIA_PREFIX):
        return text
    parsed = urlparse(text)
    if parsed.scheme in ("http", "https") and parsed.path.startswith(MEDIA_PREFIX):
        path = parsed.path
        if parsed.query:
            path += "?" + parsed.query
        return path
    return text


def media_url(kind: str, file_id: str) -> str:
    return f"{MEDIA_PREFIX}{kind}/{file_id}"


def rewrite_media_urls_in_html(html: str) -> str:
    """В html гипертекста тоже убираем хост у <img src> на /api/db/...."""
    if not html:
        return html

    def repl(match: re.Match) -> str:
        return f"{match.group('attr')}={match.group('q')}{match.group('path')}{match.group('q')}"

    return _HTML_ABS.sub(repl, html)
