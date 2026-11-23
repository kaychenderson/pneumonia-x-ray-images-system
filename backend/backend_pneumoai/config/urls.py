from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/", include("apps.inference.urls")),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.patients.urls")),
    path("api/", include("apps.exams.urls")),
    path("api/", include("apps.reports.urls")),
    path("api/", include("apps.audit.urls")),
]

if settings.ENABLE_API_DOCS:
    from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]
