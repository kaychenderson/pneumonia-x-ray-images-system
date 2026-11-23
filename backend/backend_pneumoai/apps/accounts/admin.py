from django.contrib import admin

from .models import User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    """Usuários são criados por convite (API) ou `createsuperuser`; senhas nunca são editadas aqui."""

    list_display = ("email", "name", "role", "registration", "is_active", "last_login")
    list_filter = ("role", "is_active")
    search_fields = ("email", "name", "registration")
    readonly_fields = ("last_login", "date_joined")
    fields = (
        "email",
        "name",
        "role",
        "registration",
        "specialty",
        "is_active",
        "is_staff",
        "is_superuser",
        "last_login",
        "date_joined",
    )

    def has_add_permission(self, request):
        return False
