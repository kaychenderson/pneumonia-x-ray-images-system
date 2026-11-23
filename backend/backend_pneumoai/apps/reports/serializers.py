from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer
from apps.exams.serializers import PatientRelatedField, ai_payload

from .models import Report
from .services import can_edit

MAX_TEXT = 10_000


class ReportExamSerializer(serializers.Serializer):
    """Resumo do exame dentro do laudo."""

    id = serializers.IntegerField()
    code = serializers.CharField()
    exam_date = serializers.DateField()
    projection = serializers.CharField()
    projection_display = serializers.CharField(source="get_projection_display")
    patient = PatientRelatedField(read_only=True)
    physician = UserSummarySerializer(read_only=True)
    ai = serializers.SerializerMethodField()

    def get_ai(self, obj):
        return ai_payload(obj)


class ReportListSerializer(serializers.ModelSerializer):
    exam = ReportExamSerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Report
        fields = ("id", "exam", "status", "status_display", "finalized_at", "updated_at")
        read_only_fields = fields


class ReportSerializer(ReportListSerializer):
    finalized_by = UserSummarySerializer(read_only=True)
    can_edit = serializers.SerializerMethodField()

    class Meta(ReportListSerializer.Meta):
        fields = ReportListSerializer.Meta.fields + (
            "findings",
            "conclusion",
            "finalized_by",
            "signature_name",
            "signature_registration",
            "can_edit",
            "created_at",
        )
        read_only_fields = fields

    def get_can_edit(self, obj):
        request = self.context.get("request")
        return bool(request and can_edit(request.user, obj))


class ReportWriteSerializer(serializers.Serializer):
    """Corpo de PATCH (salvar rascunho) e do POST finalize."""

    findings = serializers.CharField(required=False, allow_blank=True, max_length=MAX_TEXT)
    conclusion = serializers.CharField(required=False, allow_blank=True, max_length=MAX_TEXT)


class ReopenSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
