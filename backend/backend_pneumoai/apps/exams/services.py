import logging

from django.utils import timezone

from apps.audit.actions import Actions
from apps.audit.services import log_event
from apps.inference.service import InferenceError, ModelNotConfigured, get_classifier

from .models import AIStatus, Exam

logger = logging.getLogger(__name__)

AI_FIELDS = [
    "ai_status",
    "ai_label",
    "ai_probability",
    "ai_confidence",
    "ai_low_confidence",
    "ai_threshold",
    "ai_model_version",
    "ai_inference_ms",
    "ai_error",
    "ai_analyzed_at",
    "updated_at",
]


def _mark_failed(exam: Exam, message: str):
    exam.ai_status = AIStatus.FAILED
    exam.ai_label = ""
    exam.ai_probability = None
    exam.ai_confidence = None
    exam.ai_low_confidence = False
    exam.ai_threshold = None
    exam.ai_inference_ms = None
    exam.ai_error = message
    exam.ai_analyzed_at = timezone.now()
    exam.save(update_fields=AI_FIELDS)


def run_analysis(exam: Exam, *, request=None) -> Exam:
    """Executa a CNN sobre a imagem original do exame e grava o resultado no próprio exame.

    Nunca levanta por falha da IA: o exame permanece salvo com ai_status='failed' e o motivo
    em ai_error, para o usuário poder tentar novamente (POST /exams/{id}/analyze/).
    Não deve ser chamada dentro de transaction.atomic() (a inferência pode levar segundos).
    """
    try:
        with exam.image.open("rb") as handle:
            payload = handle.read()
        prediction = get_classifier().predict(payload)
    except (ModelNotConfigured, InferenceError) as exc:
        logger.warning("Análise indisponível para %s: %s", exam.code, exc)
        _mark_failed(exam, str(exc))
    except Exception:  # noqa: BLE001
        logger.exception("Falha inesperada na análise do exame %s", exam.code)
        _mark_failed(exam, "Falha inesperada ao processar a imagem.")
    else:
        exam.ai_status = AIStatus.COMPLETED
        exam.ai_label = prediction.label
        exam.ai_probability = round(prediction.probability_pneumonia, 6)
        exam.ai_confidence = round(prediction.confidence, 6)
        exam.ai_low_confidence = prediction.low_confidence
        exam.ai_threshold = prediction.threshold
        exam.ai_model_version = prediction.model_version
        exam.ai_inference_ms = prediction.inference_ms
        exam.ai_error = ""
        exam.ai_analyzed_at = timezone.now()
        exam.save(update_fields=AI_FIELDS)

    log_event(
        request,
        Actions.EXAM_ANALYZE,
        exam,
        status=exam.ai_status,
        label=exam.ai_label,
        model_version=exam.ai_model_version,
        inference_ms=exam.ai_inference_ms,
    )
    return exam
