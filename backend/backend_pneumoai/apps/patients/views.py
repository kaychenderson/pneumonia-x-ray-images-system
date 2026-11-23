from django.db.models import Count, Max
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.audit.actions import Actions
from apps.audit.services import log_event
from apps.core.permissions import IsAdminRole

from .filters import PatientFilter
from .models import Patient
from .serializers import PatientSerializer


class PatientViewSet(viewsets.ModelViewSet):
    """Cadastro de pacientes. Remoção só por administradores e bloqueada se houver exames."""

    serializer_class = PatientSerializer
    filterset_class = PatientFilter
    search_fields = ["full_name", "code"]
    ordering_fields = ["full_name", "created_at", "birth_date", "exams_count", "last_exam_at"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Patient.objects.annotate(
            exams_count=Count("exams", distinct=True),
            last_exam_at=Max("exams__created_at"),
        )

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAdminRole()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        patient = serializer.save(created_by=self.request.user)
        log_event(self.request, Actions.PATIENT_CREATE, patient)

    def perform_update(self, serializer):
        patient = serializer.save()
        log_event(
            self.request,
            Actions.PATIENT_UPDATE,
            patient,
            fields=sorted(serializer.validated_data.keys()),
        )

    def perform_destroy(self, instance):
        label = str(instance)
        pk = instance.pk
        instance.delete()  # ProtectedError -> 409 (exames vinculados)
        log_event(self.request, Actions.PATIENT_DELETE, None, patient_id=pk, patient=label)

    @action(detail=True, methods=["get"])
    def exams(self, request, pk=None):
        """Histórico de exames do paciente (mais recentes primeiro)."""
        from apps.exams.models import Exam
        from apps.exams.serializers import ExamListSerializer

        patient = self.get_object()
        queryset = (
            Exam.objects.filter(patient=patient)
            .select_related("patient", "physician", "report")
            .order_by("-created_at")
        )
        page = self.paginate_queryset(queryset)
        serializer = ExamListSerializer(page, many=True, context=self.get_serializer_context())
        return self.get_paginated_response(serializer.data)
