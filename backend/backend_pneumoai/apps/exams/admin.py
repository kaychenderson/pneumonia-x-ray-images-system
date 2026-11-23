from django.contrib import admin

from .models import Exam


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    """Somente leitura: registros clínicos são alterados apenas pela API (com auditoria)."""

    list_display = ("code", "patient", "physician", "exam_date", "ai_label", "ai_status")
    list_filter = ("ai_label", "ai_status", "projection")
    search_fields = ("code", "patient__full_name", "patient__code")
    exclude = ("image",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
