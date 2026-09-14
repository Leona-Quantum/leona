"""Newsroom wire models and deterministic publication checks."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from datetime import date
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import ConfigDict, Field, field_validator, model_validator
from .request_models import RequestModel


def canonical_url(value: str) -> str:
    url = urlsplit(value)
    host = (url.hostname or "").lower().rstrip(".")
    if (
        url.scheme != "https"
        or not host
        or url.username
        or url.password
        or url.port not in (None, 443)
    ):
        raise ValueError("source URL must be public HTTPS")
    if "." not in host or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("source URL must be public HTTPS")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not ip.is_global:
            raise ValueError("private source URL")
    query = urlencode(
        [
            (k, v)
            for k, v in parse_qsl(url.query)
            if not k.lower().startswith("utm_") and k not in {"fbclid", "gclid"}
        ]
    )
    return urlunsplit(("https", host, url.path or "/", query, ""))


class NewsModel(RequestModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Source(NewsModel):
    id: str = Field(pattern=r"^s[1-9][0-9]?$", max_length=3)
    title: str = Field(min_length=3, max_length=300)
    url: str = Field(max_length=2000)
    publisher: str = Field(min_length=1, max_length=150)
    published_on: date | None
    primary: bool
    # Exact location, not an unsupported claim about an entire paper.
    locator: str = Field(min_length=3, max_length=500)

    _url = field_validator("url")(canonical_url)


class Paragraph(NewsModel):
    text: str = Field(min_length=20, max_length=1500)
    sources: list[str] = Field(min_length=1, max_length=8)


class Section(NewsModel):
    heading: str = Field(min_length=3, max_length=100)
    paragraphs: list[Paragraph] = Field(min_length=1, max_length=6)


class Article(NewsModel):
    title: str = Field(min_length=8, max_length=100)
    lead: str = Field(min_length=30, max_length=400)
    category: Literal["research", "industry", "policy", "products", "guide"]
    event_date: date
    primary_source_id: str
    sources: list[Source] = Field(min_length=2, max_length=12)
    sections: list[Section] = Field(min_length=2, max_length=8)
    image_prompt: str = Field(min_length=30, max_length=1500)
    image_alt: str = Field(min_length=8, max_length=180)

    @model_validator(mode="after")
    def citations(self):
        ids = {s.id for s in self.sources}
        if len(ids) != len(self.sources) or self.primary_source_id not in ids:
            raise ValueError("source IDs must be unique and include the primary source")
        if not next(s for s in self.sources if s.id == self.primary_source_id).primary:
            raise ValueError("primary source must be marked primary")
        if len({urlsplit(s.url).hostname for s in self.sources}) < 2:
            raise ValueError("at least two source domains are required")
        for section in self.sections:
            for paragraph in section.paragraphs:
                if not set(paragraph.sources) <= ids:
                    raise ValueError("unknown citation")
        if not re.search(r"[ぁ-んァ-ヶ一-龯]", self.title + self.lead):
            raise ValueError("article must be Japanese")
        if self.event_date > date.today():
            raise ValueError("event date cannot be in the future")
        return self

    def digest(self) -> str:
        return hashlib.sha256(
            json.dumps(self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

    def event_key(self) -> str:
        source = next(s for s in self.sources if s.id == self.primary_source_id)
        return hashlib.sha256(source.url.encode()).hexdigest()


class Review(NewsModel):
    verdict: Literal["pass", "hold"]
    blockers: list[str] = Field(max_length=20)
    notes: str = Field(min_length=10, max_length=3000)
    checked_source_ids: list[str] = Field(min_length=1, max_length=12)


class CollectRequest(NewsModel):
    brief: str = Field(
        default="世界の量子コンピュータに関する、直近72時間の重要で面白いニュースを選んでください。",
        min_length=10,
        max_length=1000,
    )
    generate_image: bool = True


class PublishRequest(NewsModel):
    expected_image_digest: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    note: str = Field(min_length=5, max_length=1000)


class ImageRequest(NewsModel):
    data_base64: str = Field(min_length=20, max_length=800000)
    credit: str = Field(min_length=3, max_length=300)
    source_url: str = Field(max_length=2000)
    license_url: str = Field(max_length=2000)
    permission_note: str = Field(min_length=10, max_length=1000)
    alt: str = Field(min_length=3, max_length=180)
    _urls = field_validator("source_url", "license_url")(canonical_url)


def publication_errors(article: Article, review: dict, digest: str) -> list[str]:
    errors = []
    if article.digest() != digest:
        errors.append("content_changed")
    parsed = Review.model_validate(review.get("result", {}))
    if review.get("digest") != digest or parsed.verdict != "pass" or parsed.blockers:
        errors.append("review_not_passed")
    if set(parsed.checked_source_ids) != {s.id for s in article.sources}:
        errors.append("sources_not_checked")
    return errors


class RevisionRequest(NewsModel):
    expected_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    note: str = Field(min_length=5, max_length=1000)
    article: Article
