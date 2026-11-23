from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.exams.models import Exam

from .models import Report


@receiver(post_save, sender=Exam)
def create_report_for_exam(sender, instance, created, **kwargs):
    if created:
        Report.objects.get_or_create(exam=instance)
