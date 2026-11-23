from django.conf import settings
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .service import get_status


class HealthView(APIView):
    """Liveness/readiness simples (para Docker/ELB). Não expõe detalhes."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request):
        try:
            connection.ensure_connection()
        except Exception:  # noqa: BLE001
            return Response({"status": "degraded"}, status=503)
        return Response({"status": "ok"})


class SystemStatusView(APIView):
    """Alimenta "Sistema e modelo" nas configurações e o selo de serviços do cabeçalho."""

    def get(self, request):
        return Response(
            {
                "platform_version": settings.PLATFORM_VERSION,
                "model": get_status(),
                "analyze_on_create": settings.ANALYZE_ON_CREATE,
                "limits": {
                    "max_xray_upload_mb": settings.MAX_XRAY_UPLOAD_MB,
                    "accepted_formats": ["image/png", "image/jpeg"],
                },
            }
        )
