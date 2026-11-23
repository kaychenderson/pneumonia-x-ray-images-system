from django.conf import settings
from django.db import models


class ReportStatus(models.TextChoices):
    PENDING = "pending", "Aguardando revisão"
    DRAFT = "draft", "Em elaboração"
    FINALIZED = "finalized", "Finalizado"


class Report(models.Model):
    """Laudo médico. Criado vazio com o exame; o conteúdo é SEMPRE escrito pelo médico
    (a IA nunca preenche nem finaliza laudos)."""

    exam = models.OneToOneField("exams.Exam", on_delete=models.CASCADE, related_name="report")
    findings = models.TextField("descrição dos achados", blank=True)
    conclusion = models.TextField("impressão diagnóstica", blank=True)
    status = models.CharField(
        max_length=10, choices=ReportStatus.choices, default=ReportStatus.PENDING, db_index=True
    )

    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_finalized",
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    # Snapshot da assinatura: o laudo finalizado não muda se o médico editar o perfil depois.
    signature_name = models.CharField(max_length=150, blank=True)
    signature_registration = models.CharField(max_length=40, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Laudo {self.exam.code}"
