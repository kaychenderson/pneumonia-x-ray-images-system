from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.audit.actions import Actions
from apps.audit.services import log_event
from apps.core.exceptions import Conflict

from .models import Report, ReportStatus


def can_edit(user, report):
    if report.status == ReportStatus.FINALIZED:
        return False
    return user.role == "admin" or report.exam.physician_id == user.id


def _assert_editable(user, report):
    if report.status == ReportStatus.FINALIZED:
        raise Conflict("Laudo finalizado não pode ser editado.")
    if not can_edit(user, report):
        raise PermissionDenied("Somente o médico responsável ou um administrador pode editar o laudo.")


def _apply(report, findings, conclusion):
    if findings is not None:
        report.findings = findings.strip()
    if conclusion is not None:
        report.conclusion = conclusion.strip()


def save_draft(report, *, request, findings=None, conclusion=None):
    _assert_editable(request.user, report)
    _apply(report, findings, conclusion)
    report.status = (
        ReportStatus.DRAFT if (report.findings or report.conclusion) else ReportStatus.PENDING
    )
    report.save()
    log_event(request, Actions.REPORT_DRAFT_SAVED, report, exam=report.exam.code)
    return report


def finalize(report, *, request, findings=None, conclusion=None):
    user = request.user
    _assert_editable(user, report)
    _apply(report, findings, conclusion)
    if not report.conclusion:
        raise serializers.ValidationError(
            {"conclusion": ["Preencha a impressão diagnóstica antes de finalizar."]}
        )
    if not user.registration:
        raise serializers.ValidationError(
            {"detail": "Informe seu registro profissional (CRM) no perfil antes de finalizar laudos."}
        )
    now = timezone.now()
    # UPDATE condicional: duas finalizações simultâneas não passam juntas.
    updated = (
        Report.objects.filter(pk=report.pk)
        .exclude(status=ReportStatus.FINALIZED)
        .update(
            findings=report.findings,
            conclusion=report.conclusion,
            status=ReportStatus.FINALIZED,
            finalized_by=user,
            finalized_at=now,
            signature_name=user.name,
            signature_registration=user.registration,
            updated_at=now,
        )
    )
    if not updated:
        raise Conflict("Laudo já finalizado.")
    report.refresh_from_db()
    log_event(request, Actions.REPORT_FINALIZE, report, exam=report.exam.code)
    return report


@transaction.atomic
def reopen(report, *, request, reason):
    if report.status != ReportStatus.FINALIZED:
        raise Conflict("Somente laudos finalizados podem ser reabertos.")
    report.status = ReportStatus.DRAFT
    report.finalized_by = None
    report.finalized_at = None
    report.signature_name = ""
    report.signature_registration = ""
    report.save()
    log_event(request, Actions.REPORT_REOPEN, report, exam=report.exam.code, reason=reason)
    return report
