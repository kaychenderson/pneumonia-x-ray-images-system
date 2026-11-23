import uuid

from django.urls import reverse
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer
from apps.patients.models import Patient
from apps.patients.serializers import PatientSummarySerializer

from .models import Exam, Projection
from .validators import inspect_xray_image


class PatientRelatedField(serializers.PrimaryKeyRelatedField):
    """Entrada: id do paciente. Saída: resumo do paciente (id, código, nome, iniciais, idade)."""

    def use_pk_only_optimization(self):
        return False

    def to_representation(self, value):
        return PatientSummarySerializer(value).data


def ai_payload(exam):
    analyzed_at = exam.ai_analyzed_at
    return {
        "status": exam.ai_status,
        "label": exam.ai_label or None,
        "probability_pneumonia": exam.ai_probability,
        "confidence": exam.ai_confidence,
        "low_confidence": exam.ai_low_confidence,
        "threshold": exam.ai_threshold,
        "model_version": exam.ai_model_version or None,
        "inference_ms": exam.ai_inference_ms,
        "analyzed_at": timezone.localtime(analyzed_at).isoformat() if analyzed_at else None,
        "error": exam.ai_error or None,
    }


def report_payload(exam):
    report = getattr(exam, "report", None)  # RelatedObjectDoesNotExist herda de AttributeError
    if report is None:
        return None
    return {"id": report.pk, "status": report.status, "status_display": report.get_status_display()}


class ExamListSerializer(serializers.ModelSerializer):
    patient = PatientRelatedField(read_only=True)
    physician = UserSummarySerializer(read_only=True)
    projection_display = serializers.CharField(source="get_projection_display", read_only=True)
    ai = serializers.SerializerMethodField()
    report = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = (
            "id",
            "code",
            "patient",
            "physician",
            "exam_date",
            "projection",
            "projection_display",
            "ai",
            "report",
            "created_at",
        )
        read_only_fields = fields

    def get_ai(self, obj):
        return ai_payload(obj)

    def get_report(self, obj):
        return report_payload(obj)


class ExamSerializer(ExamListSerializer):
    """Detalhe, criação (multipart com `image`) e atualização parcial (data/projeção/observações)."""

    patient = PatientRelatedField(queryset=Patient.objects.all())
    image = serializers.ImageField(write_only=True)
    image_url = serializers.SerializerMethodField()

    class Meta(ExamListSerializer.Meta):
        fields = ExamListSerializer.Meta.fields + (
            "notes",
            "image",
            "image_url",
            "image_width",
            "image_height",
            "image_size",
            "image_sha256",
            "original_filename",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "code",
            "physician",
            "projection_display",
            "ai",
            "report",
            "created_at",
            "updated_at",
            "image_url",
            "image_width",
            "image_height",
            "image_size",
            "image_sha256",
            "original_filename",
        )

    def get_image_url(self, obj):
        url = reverse("exam-image", args=[obj.pk])
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def validate_exam_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("A data do exame não pode ser futura.")
        return value

    def validate_projection(self, value):
        if value not in Projection.values:
            raise serializers.ValidationError(f"Valores aceitos: {', '.join(Projection.values)}.")
        return value

    def validate_image(self, value):
        if self.instance is not None:
            raise serializers.ValidationError("A imagem original não pode ser substituída.")
        info = inspect_xray_image(value)
        self._image_info = info
        value.name = f"{uuid.uuid4().hex}.{info.ext}"
        return value

    def create(self, validated_data):
        info = self._image_info
        validated_data.update(
            original_filename=info.original_name,
            image_sha256=info.sha256,
            image_size=info.size,
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("patient", None)  # o paciente do exame não é trocado
        return super().update(instance, validated_data)
