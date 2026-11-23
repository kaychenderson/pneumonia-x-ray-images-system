from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
import django_filters
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.actions import ACTION_LABELS, Actions
from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.permissions import IsAdminRole
from apps.core.renderers import PassthroughRenderer
from apps.exams.models import AILabel

from . import services
from .models import Report, ReportStatus
from .pdf import build_report_pdf
from .serializers import (
    ReopenSerializer,
    ReportListSerializer,
    ReportSerializer,
    ReportWriteSerializer,
)


class ReportFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=ReportStatus.choices)
    physician = django_filters.NumberFilter(field_name="exam__physician_id")
    patient = django_filters.NumberFilter(field_name="exam__patient_id")
    result = django_filters.ChoiceFilter(field_name="exam__ai_label", choices=AILabel.choices)
    date_from = django_filters.DateFilter(field_name="exam__exam_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="exam__exam_date", lookup_expr="lte")

    class Meta:
        model = Report
        fields = ["status"]


class ReportViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Laudos. Criados automaticamente com o exame; o médico edita via PATCH e finaliza via POST."""

    queryset = Report.objects.select_related(
        "exam", "exam__patient", "exam__physician", "finalized_by"
    )
    filterset_class = ReportFilter
    search_fields = [
        "exam__code",
        "exam__patient__full_name",
        "exam__patient__code",
        "exam__physician__name",
    ]
    ordering_fields = ["created_at", "updated_at", "finalized_at", "exam__exam_date"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return ReportListSerializer
        return ReportSerializer

    def get_permissions(self):
        if self.action == "reopen":
            return [IsAdminRole()]
        return super().get_permissions()

    def _respond(self, report, status_code=200):
        return Response(self.get_serializer(report).data, status=status_code)

    def partial_update(self, request, *args, **kwargs):
        """PATCH {findings?, conclusion?}: salva rascunho."""
        report = self.get_object()
        body = ReportWriteSerializer(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        report = services.save_draft(report, request=request, **body.validated_data)
        return self._respond(report)

    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        """POST {findings?, conclusion?}: grava o texto enviado (se houver) e finaliza com assinatura."""
        report = self.get_object()
        body = ReportWriteSerializer(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        report = services.finalize(report, request=request, **body.validated_data)
        return self._respond(report)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """Somente administradores; exige justificativa (fica na auditoria)."""
        report = self.get_object()
        body = ReopenSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        report = services.reopen(report, request=request, reason=body.validated_data["reason"])
        return self._respond(report)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Linha do tempo do laudo (eventos de auditoria do laudo e do exame)."""
        report = self.get_object()
        exam_events = [Actions.EXAM_CREATE, Actions.EXAM_ANALYZE]
        logs = (
            AuditLog.objects.filter(
                Q(object_type="report", object_id=str(report.pk))
                | Q(object_type="exam", object_id=str(report.exam_id), action__in=exam_events)
            )
            .select_related("user")
            .order_by("created_at", "id")
        )
        return Response(
            [
                {
                    "at": timezone.localtime(log.created_at).isoformat(),
                    "action": log.action,
                    "label": ACTION_LABELS.get(log.action, log.action),
                    "user": {"id": log.user_id, "name": log.user.name} if log.user_id else None,
                }
                for log in logs
            ]
        )

    @action(detail=True, methods=["get"], renderer_classes=[PassthroughRenderer])
    def pdf(self, request, pk=None):
        """PDF do laudo (pré-visualização inline; `?download=1` força download).

        Rascunhos saem com marca d'água "RASCUNHO"."""
        report = self.get_object()
        content = build_report_pdf(
            report, tz=timezone.get_current_timezone(), generated_at=timezone.now()
        )
        log_event(request, Actions.REPORT_PDF, report, exam=report.exam.code)
        disposition = "attachment" if request.query_params.get("download") else "inline"
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = f'{disposition}; filename="laudo-{report.exam.code}.pdf"'
        response["Cache-Control"] = "private, no-store"
        return response
