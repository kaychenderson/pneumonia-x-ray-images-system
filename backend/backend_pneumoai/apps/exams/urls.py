from django.urls import path
from rest_framework.routers import SimpleRouter

from .dashboard import DashboardView
from .views import ExamViewSet

router = SimpleRouter()
router.register("exams", ExamViewSet, basename="exam")

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
] + router.urls
