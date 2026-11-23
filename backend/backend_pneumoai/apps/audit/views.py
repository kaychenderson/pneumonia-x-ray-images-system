from datetime import timedelta

import django_filters
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.core.permissions import IsAdminRole

from .actions import Actions
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    action = django_filters.CharFilter(field_name="action", lookup_expr="icontains")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = AuditLog
        fields = ["user", "object_type", "object_id"]


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Somente leitura, só para administradores."""

    queryset = AuditLog.objects.select_related("user")
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminRole]
    filterset_class = AuditLogFilter
    search_fields = ["user_email", "action", "object_repr"]
    ordering_fields = ["created_at", "action"]
    ordering = ["-created_at"]


class AdminSummaryView(APIView):
    """Cartões da tela de administração."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        today_start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        active = User.objects.filter(is_active=True)
        return Response(
            {
                "active_users": active.count(),
                "active_doctors": active.filter(role=Role.DOCTOR).count(),
                "admins": active.filter(role=Role.ADMIN).count(),
                "accesses_today": AuditLog.objects.filter(
                    action=Actions.LOGIN, created_at__gte=today_start
                ).count(),
                "failed_logins_today": AuditLog.objects.filter(
                    action=Actions.LOGIN_FAILED, created_at__gte=today_start
                ).count(),
                "audit_logs_30d": AuditLog.objects.filter(
                    created_at__gte=timezone.now() - timedelta(days=30)
                ).count(),
            }
        )
