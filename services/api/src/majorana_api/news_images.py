"""Decode, bound and re-encode uploaded/generated rasters; never fetch URLs."""

import io
import warnings
from PIL import Image, ImageOps


def normalize_image(data: bytes) -> bytes:
    if not 1 <= len(data) <= 8_000_000:
        raise ValueError("image exceeds the input size limit")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("PNG, JPEG or WebP required")
                if image.width * image.height > 16_000_000 or min(image.size) < 320:
                    raise ValueError("image dimensions are outside allowed bounds")
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.thumbnail((1600, 1200))
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=82, method=4)
                result = output.getvalue()
        except (OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError("invalid or oversized image") from exc
    if len(result) > 600000:
        raise ValueError("compressed image exceeds 600 KB")
    return result
