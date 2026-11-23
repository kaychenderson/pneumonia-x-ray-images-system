from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Perfil 'Administrador' da plataforma (não confundir com is_staff do Django admin)."""

    message = "Acesso restrito a administradores."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == "admin")
