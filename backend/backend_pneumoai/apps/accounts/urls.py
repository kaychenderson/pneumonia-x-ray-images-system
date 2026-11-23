from django.urls import path
from rest_framework.routers import SimpleRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

router = SimpleRouter()
router.register("users", views.UserViewSet, basename="user")

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/register/", views.RegisterView.as_view(), name="auth-register"),
    path("auth/password/forgot/", views.PasswordForgotView.as_view(), name="auth-password-forgot"),
    path("auth/password/reset/", views.PasswordResetView.as_view(), name="auth-password-reset"),
    path("auth/password/change/", views.PasswordChangeView.as_view(), name="auth-password-change"),
    path("auth/me/", views.MeView.as_view(), name="auth-me"),
    path("auth/me/avatar/", views.MeAvatarView.as_view(), name="auth-me-avatar"),
    path("auth/avatar/<int:pk>/", views.AvatarView.as_view(), name="user-avatar"),
] + router.urls
