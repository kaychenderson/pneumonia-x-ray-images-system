import hashlib
import os
from dataclasses import dataclass

from django.conf import settings
from PIL import Image
from rest_framework import serializers

ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png"}
MIN_SIDE_PX = 64


@dataclass(frozen=True)
class ImageInfo:
    ext: str
    size: int
    sha256: str
    original_name: str
    width: int
    height: int


def inspect_xray_image(upload):
    """Valida pelo CONTEÚDO (não pela extensão/Content-Type) e calcula metadados de integridade.

    A imagem em si não é alterada: o arquivo original é o que fica armazenado e o que a CNN lê.
    """
    max_mb = settings.MAX_XRAY_UPLOAD_MB
    if upload.size > max_mb * 1024 * 1024:
        raise serializers.ValidationError(f"A imagem deve ter no máximo {max_mb} MB.")

    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)

    try:
        upload.seek(0)
        with Image.open(upload) as img:
            fmt = img.format
            width, height = img.size
            img.verify()
    except Exception as exc:  # noqa: BLE001 - qualquer falha do Pillow = arquivo inválido
        raise serializers.ValidationError("Arquivo de imagem inválido ou corrompido.") from exc
    finally:
        upload.seek(0)

    if fmt not in ALLOWED_FORMATS:
        raise serializers.ValidationError("Formato não suportado. Use PNG ou JPEG.")
    if min(width, height) < MIN_SIDE_PX:
        raise serializers.ValidationError("Imagem muito pequena para análise.")

    return ImageInfo(
        ext=ALLOWED_FORMATS[fmt],
        size=upload.size,
        sha256=digest.hexdigest(),
        original_name=os.path.basename(upload.name or "")[:255],
        width=width,
        height=height,
    )
