import django_filters

from apps.reports.models import ReportStatus

from .models import AILabel, Exam


class ExamFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="exam_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="exam_date", lookup_expr="lte")
    result = django_filters.ChoiceFilter(field_name="ai_label", choices=AILabel.choices)
    report_status = django_filters.ChoiceFilter(
        field_name="report__status", choices=ReportStatus.choices
    )

    class Meta:
        model = Exam
        fields = ["patient", "physician", "projection", "ai_status", "ai_low_confidence"]
