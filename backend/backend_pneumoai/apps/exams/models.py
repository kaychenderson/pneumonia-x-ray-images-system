import os
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import Sequence


class Projection(models.TextChoices):
    UNSPECIFIED = "unspecified", "Não informada"
    PA = "PA", "PA"
    AP = "AP", "AP"
    LATERAL = "LATERAL", "Perfil"


class AIStatus(models.TextChoices):
    PENDING = "pending", "Pendente"
    COMPLETED = "completed", "Concluída"
    FAILED = "failed", "Falhou"


class AILabel(models.TextChoices):
    NORMAL = "NORMAL", "Normal"
    PNEUMONIA = "PNEUMONIA", "Pneumonia"


def exam_image_upload_to(instance, filename):
    # Nome aleatório: o arquivo não carrega nome do paciente nem do exame (LGPD).
    ext = os.path.splitext(filename)[1].lower() or ".img"
    return f"exams/{timezone.now():%Y/%m}/{uuid.uuid4().hex}{ext}"


class Exam(models.Model):
    code = models.CharField("código", max_length=20, unique=True, blank=True)  # RX-2026-0001
    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="exams")
    physician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="exams"
    )
    exam_date = models.DateField("data do exame", default=timezone.localdate)
    projection = models.CharField(
        max_length=12, choices=Projection.choices, default=Projection.UNSPECIFIED
    )
    notes = models.TextField("observações", blank=True)

    # Imagem original (preservada sem alteração) + metadados de integridade
    image = models.ImageField(
        upload_to=exam_image_upload_to,
        max_length=255,
        width_field="image_width",
        height_field="image_height",
    )
    image_width = models.PositiveIntegerField(null=True, blank=True)
    image_height = models.PositiveIntegerField(null=True, blank=True)
    image_size = models.PositiveIntegerField(default=0)
    image_sha256 = models.CharField(max_length=64, blank=True)
    original_filename = models.CharField(max_length=255, blank=True)

    # Resultado da IA (apoio à decisão; nunca preenche nem finaliza o laudo)
    ai_status = models.CharField(max_length=10, choices=AIStatus.choices, default=AIStatus.PENDING)
    ai_label = models.CharField(max_length=10, choices=AILabel.choices, blank=True)
    ai_probability = models.FloatField(null=True, blank=True)  # P(PNEUMONIA)
    ai_confidence = models.FloatField(null=True, blank=True)  # prob. da classe prevista
    ai_low_confidence = models.BooleanField(default=False)
    ai_threshold = models.FloatField(null=True, blank=True)
    ai_model_version = models.CharField(max_length=80, blank=True)
    ai_inference_ms = models.PositiveIntegerField(null=True, blank=True)
    ai_error = models.TextField(blank=True)
    ai_analyzed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["exam_date"]),
            models.Index(fields=["ai_label"]),
        ]

    def __str__(self):
        return self.code or f"Exame #{self.pk}"

    def save(self, *args, **kwargs):
        if not self.code:
            year = timezone.localdate().year
            self.code = f"RX-{year}-{Sequence.next(f'exam-{year}'):04d}"
        super().save(*args, **kwargs)
