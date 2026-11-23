from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import AdminSummaryView, AuditLogViewSet

router = SimpleRouter()
router.register("audit-logs", AuditLogViewSet, basename="audit-log")

urlpatterns = [
    path("admin/summary/", AdminSummaryView.as_view(), name="admin-summary"),
] + router.urls
