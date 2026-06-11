from __future__ import annotations

import json
import logging
import re
from html import unescape
from pathlib import Path
from typing import Any

import httpx

from edu_multi_agent.models import GenerationRequest


logger = logging.getLogger(__name__)

COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php"
IMAGE_ASSETS_DIRNAME = "05_image_assets"
IMAGE_ASSETS_MANIFEST = "image_assets.json"
MAX_IMAGE_ASSETS = 3
REQUEST_TIMEOUT_SECONDS = 12
USER_AGENT = "edu-multi-agent/0.1 image-asset-fetcher"
ACCEPTED_IMAGE_MIME_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}


def build_commons_image_assets_for_request(
    request: GenerationRequest,
    output_dir: Path,
    *,
    limit: int = MAX_IMAGE_ASSETS,
) -> list[dict[str, str]]:
    """Find and cache local Wikimedia Commons image assets for a prep run."""
    target_dir = output_dir / IMAGE_ASSETS_DIRNAME
    manifest_path = target_dir / IMAGE_ASSETS_MANIFEST
    cached_assets = _load_cached_assets(manifest_path)
    if cached_assets is not None:
        return cached_assets[:limit]

    target_dir.mkdir(parents=True, exist_ok=True)
    assets: list[dict[str, str]] = []
    seen_source_urls: set[str] = set()

    for query in _build_search_queries(request):
        if len(assets) >= limit:
            break
        try:
            search_results = search_commons_images(query, limit=max(limit * 3, 6))
        except Exception as exc:
            logger.warning("Wikimedia Commons image search failed for %r: %s", query, exc)
            continue

        for result in search_results:
            if len(assets) >= limit:
                break
            source_url = str(result.get("source_url") or "")
            if source_url in seen_source_urls:
                continue
            seen_source_urls.add(source_url)
            try:
                asset = download_image_asset(result, target_dir)
            except Exception as exc:
                logger.warning(
                    "Wikimedia Commons image download failed for %r: %s",
                    result.get("title") or source_url,
                    exc,
                )
                continue
            if asset is not None:
                assets.append(asset)

    _write_assets_manifest(manifest_path, assets)
    return assets[:limit]


def search_commons_images(query: str, limit: int = MAX_IMAGE_ASSETS) -> list[dict[str, str]]:
    """Search Wikimedia Commons images and return normalized metadata."""
    cleaned_query = query.strip()
    if not cleaned_query:
        return []

    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": cleaned_query,
        "gsrnamespace": "6",
        "gsrlimit": str(max(limit, 1)),
        "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata",
        "iiurlwidth": "1280",
        "format": "json",
        "origin": "*",
    }
    with httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=True,
    ) as client:
        response = client.get(COMMONS_API_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    pages = ((payload.get("query") or {}).get("pages") or {})
    if not isinstance(pages, dict):
        return []

    results: list[dict[str, str]] = []
    for page in sorted(
        pages.values(),
        key=lambda item: int(item.get("index") or 9999) if isinstance(item, dict) else 9999,
    ):
        if not isinstance(page, dict):
            continue
        imageinfo_items = page.get("imageinfo")
        if not isinstance(imageinfo_items, list) or not imageinfo_items:
            continue
        imageinfo = imageinfo_items[0]
        if not isinstance(imageinfo, dict):
            continue
        mime_type = str(imageinfo.get("mime") or "").lower()
        if mime_type not in ACCEPTED_IMAGE_MIME_TYPES:
            continue
        metadata = imageinfo.get("extmetadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        title = _clean_title(str(page.get("title") or metadata_value(metadata, "ObjectName")))
        description = metadata_value(metadata, "ImageDescription")
        artist = metadata_value(metadata, "Artist")
        license_name = metadata_value(metadata, "LicenseShortName")
        license_url = metadata_value(metadata, "LicenseUrl")
        source_url = str(imageinfo.get("descriptionurl") or imageinfo.get("url") or "")
        image_url = str(imageinfo.get("url") or "")
        download_url = str(imageinfo.get("thumburl") or imageinfo.get("url") or "")
        if not download_url or not image_url:
            continue
        results.append(
            {
                "title": title,
                "description": description,
                "artist": artist,
                "license": license_name,
                "license_url": license_url,
                "mime_type": mime_type,
                "image_url": image_url,
                "download_url": download_url,
                "source_url": source_url,
                "width": str(imageinfo.get("thumbwidth") or imageinfo.get("width") or ""),
                "height": str(imageinfo.get("thumbheight") or imageinfo.get("height") or ""),
            }
        )
    return results


def download_image_asset(
    result: dict[str, str],
    target_dir: Path,
) -> dict[str, str] | None:
    """Download one normalized Commons result into the local prep output folder."""
    mime_type = str(result.get("mime_type") or "").lower()
    extension = ACCEPTED_IMAGE_MIME_TYPES.get(mime_type)
    if extension is None:
        return None

    download_url = str(result.get("download_url") or result.get("image_url") or "")
    if not download_url:
        return None

    with httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=True,
    ) as client:
        response = client.get(download_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";")[0].lower()
        if content_type in ACCEPTED_IMAGE_MIME_TYPES:
            extension = ACCEPTED_IMAGE_MIME_TYPES[content_type]
        elif not content_type.startswith("image/"):
            return None
        content = response.content

    if not content:
        return None

    title = result.get("title") or "commons-image"
    file_path = _unique_path(target_dir, _safe_filename(title), extension)
    file_path.write_bytes(content)
    relative_path = f"{IMAGE_ASSETS_DIRNAME}/{file_path.name}"
    attribution = _build_attribution(result)
    return {
        "title": title,
        "description": result.get("description") or title,
        "artist": result.get("artist") or "",
        "license": result.get("license") or "",
        "license_url": result.get("license_url") or "",
        "source_url": result.get("source_url") or "",
        "image_url": result.get("image_url") or "",
        "mime_type": mime_type,
        "file_path": str(file_path.resolve()),
        "relative_path": relative_path,
        "attribution": attribution,
    }


def build_image_media_resources(assets: list[dict[str, str]]) -> list[dict[str, str]]:
    """Convert cached image assets to classroom media resource entries."""
    resources: list[dict[str, str]] = []
    for asset in assets:
        file_path = str(asset.get("file_path") or "")
        relative_path = str(asset.get("relative_path") or "")
        if not file_path or not relative_path:
            continue
        title = asset.get("title") or "教学图片素材"
        description = asset.get("description") or title
        resources.append(
            {
                "resource_type": "image",
                "file_path": file_path,
                "relative_path": relative_path,
                "description": f"{title} - {description}",
                "source_agent": "image_asset",
                "attribution": asset.get("attribution") or "",
                "source_url": asset.get("source_url") or "",
            }
        )
    return resources


def metadata_value(metadata: dict[str, Any], key: str) -> str:
    raw_value = metadata.get(key)
    if isinstance(raw_value, dict):
        raw_value = raw_value.get("value")
    if raw_value is None:
        return ""
    return _clean_metadata_text(str(raw_value))


def _build_search_queries(request: GenerationRequest) -> list[str]:
    candidates = [
        f"{request.subject} {request.learning_goal}",
        request.learning_goal,
        request.subject,
    ]
    queries: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        query = " ".join(str(candidate or "").split())
        if not query or query in seen:
            continue
        seen.add(query)
        queries.append(query[:200])
    return queries


def _load_cached_assets(manifest_path: Path) -> list[dict[str, str]] | None:
    if not manifest_path.is_file():
        return None
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    assets = payload.get("assets") if isinstance(payload, dict) else None
    if not isinstance(assets, list):
        return None
    cached_assets: list[dict[str, str]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        file_path = Path(str(asset.get("file_path") or ""))
        if file_path.is_file():
            cached_assets.append({str(key): str(value) for key, value in asset.items()})
    return cached_assets


def _write_assets_manifest(manifest_path: Path, assets: list[dict[str, str]]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"assets": assets}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _clean_title(value: str) -> str:
    title = value.strip()
    if title.lower().startswith("file:"):
        title = title[5:]
    return re.sub(r"\.(png|jpe?g|webp|svg)$", "", title, flags=re.IGNORECASE).strip() or "Commons image"


def _clean_metadata_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _safe_filename(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned[:80] or "commons-image"


def _unique_path(target_dir: Path, stem: str, extension: str) -> Path:
    candidate = target_dir / f"{stem}{extension}"
    index = 2
    while candidate.exists():
        candidate = target_dir / f"{stem}-{index}{extension}"
        index += 1
    return candidate


def _build_attribution(result: dict[str, str]) -> str:
    parts = [
        result.get("artist") or "Unknown creator",
        result.get("license") or "Unknown license",
        "Wikimedia Commons",
    ]
    source_url = result.get("source_url")
    if source_url:
        parts.append(source_url)
    return ", ".join(part for part in parts if part)
