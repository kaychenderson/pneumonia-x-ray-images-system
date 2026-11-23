from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import Sequence


def next_patient_code():
    while True:
        code = f"PAC-{Sequence.next('patient'):05d}"
        if not Patient.objects.filter(code=code).exists():
            return code


class Patient(models.Model):
    code = models.CharField("identificação", max_length=20, unique=True, blank=True)
    full_name = models.CharField("nome completo", max_length=200, db_index=True)
    birth_date = models.DateField("data de nascimento")
    phone = models.CharField("telefone", max_length=30, blank=True)
    email = models.EmailField("e-mail", blank=True)
    notes = models.TextField("observações clínicas", blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="patients_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.full_name} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = next_patient_code()
        super().save(*args, **kwargs)

    @property
    def age(self):
        today = timezone.localdate()
        born = self.birth_date
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
