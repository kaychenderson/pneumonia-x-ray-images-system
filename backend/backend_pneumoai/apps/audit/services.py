import logging

from apps.core.utils import get_client_ip

from .models import AuditLog

logger = logging.getLogger(__name__)


def log_event(request, action, obj=None, *, user=None, email="", **metadata):
    """Grava um evento de auditoria. Nunca interrompe a requisição se a gravação falhar.

    `metadata` deve conter apenas valores serializáveis em JSON e nunca dados sensíveis
    (senhas, tokens, conteúdo clínico).
    """
    try:
        actor = user or getattr(request, "user", None)
        if actor is not None and not getattr(actor, "is_authenticated", False):
            actor = None
        meta = getattr(request, "META", {}) if request is not None else {}
        AuditLog.objects.create(
            user=actor,
            user_email=((getattr(actor, "email", "") or email) or "")[:254],
            action=action,
            object_type=obj._meta.model_name if obj is not None else "",
            object_id=str(obj.pk) if obj is not None and obj.pk is not None else "",
            object_repr=str(obj)[:200] if obj is not None else "",
            ip_address=get_client_ip(request),
            user_agent=meta.get("HTTP_USER_AGENT", "")[:255],
            metadata=metadata,
        )
    except Exception:  # noqa: BLE001 - auditoria não pode derrubar o fluxo clínico
        logger.exception("Falha ao gravar auditoria (%s)", action)
