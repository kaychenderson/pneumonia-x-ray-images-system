from django.contrib import admin

from .models import Patient


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ("code", "full_name", "birth_date", "created_at")
    search_fields = ("code", "full_name")
    readonly_fields = ("created_at", "updated_at")
