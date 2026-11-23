import io

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps
from rest_framework import serializers

ALLOWED_AVATAR_FORMATS = {"JPEG", "PNG", "WEBP"}
AVATAR_MAX_SIDE = 512


def process_avatar(upload):
    """Valida e reencoda a foto de perfil em JPEG 512px (remove EXIF/GPS e metadados)."""
    max_bytes = settings.MAX_AVATAR_UPLOAD_MB * 1024 * 1024
    if upload.size > max_bytes:
        raise serializers.ValidationError(
            f"A foto deve ter no máximo {settings.MAX_AVATAR_UPLOAD_MB} MB."
        )
    try:
        upload.seek(0)
        with Image.open(upload) as probe:
            if probe.format not in ALLOWED_AVATAR_FORMATS:
                raise serializers.ValidationError("Use uma imagem PNG, JPEG ou WebP.")
        upload.seek(0)
        with Image.open(upload) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((AVATAR_MAX_SIDE, AVATAR_MAX_SIDE))
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGBA")
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.getchannel("A"))
                img = background
            else:
                img = img.convert("RGB")
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=88, optimize=True)
    except serializers.ValidationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise serializers.ValidationError("Imagem inválida ou corrompida.") from exc
    return ContentFile(buffer.getvalue(), name="avatar.jpg")
