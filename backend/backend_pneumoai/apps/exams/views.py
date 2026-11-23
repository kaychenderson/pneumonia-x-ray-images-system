import mimetypes

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.audit.actions import Actions
from apps.audit.services import log_event
from apps.core.exceptions import Conflict
from apps.core.permissions import IsAdminRole
from apps.core.renderers import PassthroughRenderer
from apps.reports.models import ReportStatus

from . import services
from .filters import ExamFilter
from .models import AIStatus, Exam
from .serializers import ExamListSerializer, ExamSerializer


def _report_is_finalized(exam):
    report = getattr(exam, "report", None)
    return report is not None and report.status == ReportStatus.FINALIZED


class ExamViewSet(viewsets.ModelViewSet):
    """Exames de radiografia de tórax.

    POST (multipart: patient, exam_date, projection, notes, image) registra o exame e, com
    ANALYZE_ON_CREATE=True, já executa a CNN. Se a IA estiver indisponível o exame é salvo
    mesmo assim (ai.status = "failed") e a análise pode ser repetida em POST /exams/{id}/analyze/.
    """

    queryset = Exam.objects.select_related("patient", "physician", "report")
    filterset_class = ExamFilter
    search_fields = ["code", "patient__full_name", "patient__code", "physician__name"]
    ordering_fields = ["created_at", "exam_date", "code", "ai_probability", "ai_confidence"]
    ordering = ["-created_at"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        return ExamListSerializer if self.action == "list" else ExamSerializer

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAdminRole()]
        return [IsAuthenticated()]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action in {"create", "analyze"}:
            self.throttle_scope = "analysis"
            throttles.append(ScopedRateThrottle())
        return throttles

    # -- regras de acesso ---------------------------------------------------
    def _ensure_can_modify(self, exam):
        user = self.request.user
        if user.role != "admin" and exam.physician_id != user.id:
            raise PermissionDenied("Somente o médico responsável ou um administrador pode alterar o exame.")
        if _report_is_finalized(exam):
            raise Conflict("O laudo deste exame está finalizado; o exame não pode mais ser alterado.")

    # -- CRUD ---------------------------------------------------------------
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        exam = serializer.save(physician=request.user)
        log_event(request, Actions.EXAM_CREATE, exam, patient_id=exam.patient_id)
        if settings.ANALYZE_ON_CREATE:
            services.run_analysis(exam, request=request)
        exam = self.get_queryset().get(pk=exam.pk)
        data = self.get_serializer(exam).data
        return Response(data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        self._ensure_can_modify(serializer.instance)
        exam = serializer.save()
        log_event(
            self.request, Actions.EXAM_UPDATE, exam, fields=sorted(serializer.validated_data.keys())
        )

    def perform_destroy(self, instance):
        if _report_is_finalized(instance):
            raise Conflict("Exames com laudo finalizado não podem ser removidos.")
        code, pk = instance.code, instance.pk
        image = instance.image
        instance.delete()
        image.delete(save=False)
        log_event(self.request, Actions.EXAM_DELETE, None, exam_id=pk, code=code)

    # -- ações --------------------------------------------------------------
    @action(detail=True, methods=["post"])
    def analyze(self, request, pk=None):
        """(Re)executa a CNN sobre a imagem original. Responde 503 se a IA estiver indisponível."""
        exam = self.get_object()
        if _report_is_finalized(exam):
            raise Conflict("O laudo está finalizado; não é possível refazer a análise.")
        services.run_analysis(exam, request=request)
        data = self.get_serializer(exam).data
        if exam.ai_status != AIStatus.COMPLETED:
            return Response(
                {"detail": exam.ai_error, "code": "ai_unavailable", "exam": data},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(data)

    @action(detail=True, methods=["get"], renderer_classes=[PassthroughRenderer])
    def image(self, request, pk=None):
        """Imagem original. Exige o header Authorization: no front use fetch() + URL.createObjectURL()."""
        exam = self.get_object()
        if not exam.image:
            raise Http404
        log_event(request, Actions.EXAM_IMAGE_VIEW, exam)
        content_type = mimetypes.guess_type(exam.image.name)[0] or "application/octet-stream"
        extension = mimetypes.guess_extension(content_type) or ""
        response = FileResponse(exam.image.open("rb"), content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{exam.code}{extension}"'
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
