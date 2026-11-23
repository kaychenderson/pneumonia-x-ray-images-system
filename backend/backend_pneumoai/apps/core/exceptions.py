from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Operação em conflito com o estado atual do registro."
    default_code = "conflict"


def api_exception_handler(exc, context):
    """Padroniza erros: {"detail": "...", "code": "..."} (campos inválidos: {campo: [msgs]})."""
    if isinstance(exc, ProtectedError):
        return Response(
            {
                "detail": "O registro possui dados vinculados e não pode ser removido.",
                "code": "protected",
            },
            status=status.HTTP_409_CONFLICT,
        )
    response = exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict):
        code = getattr(response.data.get("detail"), "code", None)
        if code and "code" not in response.data:
            response.data["code"] = code
    return response
