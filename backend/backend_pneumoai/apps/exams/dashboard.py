from django.db.models import Count
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import add_months
from apps.patients.models import Patient
from apps.reports.models import Report, ReportStatus

from .models import AILabel, AIStatus, Exam
from .serializers import ExamListSerializer

MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def _pct(part, whole):
    return round(100 * part / whole, 1) if whole else 0.0


def _as_date(value):
    return value.date() if hasattr(value, "date") else value


class DashboardView(APIView):
    """Dados da "Visão geral": cartões, volume mensal, distribuição da IA e atividade recente.

    ?months=12 (1..24) controla a janela do gráfico de volume e da distribuição da IA.
    """

    def get(self, request):
        try:
            months = max(1, min(24, int(request.query_params.get("months", 12))))
        except ValueError:
            months = 12

        today = timezone.localdate()
        month_start = today.replace(day=1)
        prev_start = add_months(month_start, -1)
        window_start = add_months(month_start, -(months - 1))

        # --- cartões -------------------------------------------------------
        exams_total = Exam.objects.count()
        exams_this_month = Exam.objects.filter(exam_date__gte=month_start).count()
        exams_prev_month = Exam.objects.filter(
            exam_date__gte=prev_start, exam_date__lt=month_start
        ).count()
        growth = (
            round(100 * (exams_this_month - exams_prev_month) / exams_prev_month, 1)
            if exams_prev_month
            else None
        )

        reports_total = Report.objects.count()
        reports_finalized = Report.objects.filter(status=ReportStatus.FINALIZED).count()
        awaiting = Report.objects.exclude(status=ReportStatus.FINALIZED)
        awaiting_count = awaiting.count()
        priority_count = awaiting.filter(exam__ai_label=AILabel.PNEUMONIA).count()

        cards = {
            "patients_total": Patient.objects.count(),
            "patients_new_this_month": Patient.objects.filter(
                created_at__date__gte=month_start
            ).count(),
            "exams_total": exams_total,
            "exams_this_month": exams_this_month,
            "exams_growth_percent": growth,
            # "Aguardando revisão": laudos ainda não finalizados (pendentes + em elaboração);
            # prioritários = os que a IA classificou como PNEUMONIA.
            "awaiting_review": awaiting_count,
            "awaiting_review_priority": priority_count,
            "reports_finalized": reports_finalized,
            "reports_finalized_percent": _pct(reports_finalized, reports_total),
        }

        # --- volume mensal (preenche meses sem exames com 0) ---------------
        rows = (
            Exam.objects.filter(exam_date__gte=window_start)
            .annotate(m=TruncMonth("exam_date"))
            .values("m")
            .annotate(total=Count("id"))
        )
        by_month = {_as_date(row["m"]): row["total"] for row in rows}
        series = []
        for offset in range(months):
            first = add_months(window_start, offset)
            series.append(
                {
                    "period": first.strftime("%Y-%m"),
                    "month": MONTH_LABELS[first.month - 1],
                    "exams": by_month.get(first, 0),
                }
            )

        # --- distribuição da IA no período --------------------------------
        dist_rows = (
            Exam.objects.filter(exam_date__gte=window_start, ai_status=AIStatus.COMPLETED)
            .values("ai_label")
            .annotate(total=Count("id"))
        )
        counts = {row["ai_label"]: row["total"] for row in dist_rows}
        normal = counts.get(AILabel.NORMAL, 0)
        pneumonia = counts.get(AILabel.PNEUMONIA, 0)
        classified = normal + pneumonia
        distribution = {
            "total": classified,
            "normal": {"count": normal, "percent": _pct(normal, classified)},
            "pneumonia": {"count": pneumonia, "percent": _pct(pneumonia, classified)},
        }

        recent = Exam.objects.select_related("patient", "physician", "report").order_by("-created_at")[:5]

        return Response(
            {
                "generated_at": timezone.now(),
                "period_months": months,
                "period_start": window_start,
                "cards": cards,
                "exams_by_month": series,
                "ai_distribution": distribution,
                "recent_exams": ExamListSerializer(
                    recent, many=True, context={"request": request}
                ).data,
            }
        )
