from django.contrib import admin

from .models import Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """Somente leitura: laudos são editados apenas pela API (com trilha de auditoria)."""

    list_display = ("exam", "status", "finalized_by", "finalized_at")
    list_filter = ("status",)
    search_fields = ("exam__code", "exam__patient__full_name")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
