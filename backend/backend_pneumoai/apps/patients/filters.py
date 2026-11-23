from datetime import timedelta

import django_filters
from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.core.utils import years_ago

from .models import Patient


class PatientFilter(django_filters.FilterSet):
    """Filtros da tela de pacientes: faixa etária e período do último exame."""

    age_group = django_filters.ChoiceFilter(
        choices=[("minor", "Até 18 anos"), ("adult", "19–59 anos"), ("senior", "60 anos ou mais")],
        method="filter_age_group",
    )
    last_exam = django_filters.ChoiceFilter(
        choices=[("7d", "Últimos 7 dias"), ("30d", "Últimos 30 dias"), ("90d", "Últimos 90 dias")],
        method="filter_last_exam",
    )

    class Meta:
        model = Patient
        fields = []

    def filter_age_group(self, queryset, name, value):
        today = timezone.localdate()
        born_19_or_more_years_ago = years_ago(today, 19)
        born_60_or_more_years_ago = years_ago(today, 60)
        if value == "minor":  # idade <= 18
            return queryset.filter(birth_date__gt=born_19_or_more_years_ago)
        if value == "adult":  # 19..59
            return queryset.filter(
                birth_date__lte=born_19_or_more_years_ago, birth_date__gt=born_60_or_more_years_ago
            )
        if value == "senior":  # >= 60
            return queryset.filter(birth_date__lte=born_60_or_more_years_ago)
        return queryset

    def filter_last_exam(self, queryset, name, value):
        from apps.exams.models import Exam

        days = {"7d": 7, "30d": 30, "90d": 90}.get(value)
        if not days:
            return queryset
        since = timezone.localdate() - timedelta(days=days)
        recent = Exam.objects.filter(patient=OuterRef("pk"), exam_date__gte=since)
        return queryset.filter(Exists(recent))
