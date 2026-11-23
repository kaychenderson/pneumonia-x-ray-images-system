from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Trilha de auditoria imutável (LGPD: quem acessou/alterou o quê e quando)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    user_email = models.CharField(max_length=254, blank=True)  # snapshot (inclui logins falhos)
    action = models.CharField(max_length=60, db_index=True)
    object_type = models.CharField(max_length=40, blank=True)
    object_id = models.CharField(max_length=40, blank=True)
    object_repr = models.CharField(max_length=200, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["object_type", "object_id"])]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.action} {self.user_email}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Registros de auditoria são imutáveis.")
        super().save(*args, **kwargs)
