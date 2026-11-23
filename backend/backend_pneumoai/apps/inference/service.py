"""Serviço de inferência da CNN DenseNet121 (pneumonia em radiografias de tórax).

Contrato com o treino (training/train_densenet121.py) que este módulo REPLICA:
  * imagem decodificada em RGB (3 canais) e redimensionada com tf.image.resize (bilinear)
    para o tamanho de entrada do modelo (224x224) -- exatamente como image_dataset_from_directory;
  * pixels divididos por 255.0. O modelo salvo NÃO contém a normalização (ela foi feita no
    tf.data com .map(normalize)), logo ela tem de ser refeita aqui. Não use preprocess_input;
  * saída: 1 neurônio sigmoid = P(PNEUMONIA). Classes em ordem alfabética: [NORMAL, PNEUMONIA];
  * as camadas de data augmentation fazem parte do modelo mas são inativas fora do treino.

O TensorFlow é importado de forma preguiçosa: `migrate`, `check` e os testes não pagam o custo
de carregá-lo, e a aplicação sobe mesmo sem o arquivo .keras (as análises ficam "failed").
"""

from __future__ import annotations

import hashlib
import logging
import math
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

LABEL_NORMAL = "NORMAL"
LABEL_PNEUMONIA = "PNEUMONIA"


class ModelNotConfigured(RuntimeError):
    """Modelo ausente, TensorFlow indisponível ou arquivo incompatível."""


class InferenceError(RuntimeError):
    """Falha ao processar uma imagem específica."""


@dataclass(frozen=True)
class Prediction:
    label: str
    probability_pneumonia: float
    confidence: float
    low_confidence: bool
    threshold: float
    model_version: str
    inference_ms: int


class PneumoniaClassifier:
    def __init__(self, model_path, *, class_names, threshold, low_confidence, version=""):
        names = [str(n).upper() for n in class_names]
        if len(names) != 2 or set(names) != {LABEL_NORMAL, LABEL_PNEUMONIA}:
            raise ValueError("MODEL_CLASS_NAMES deve conter NORMAL e PNEUMONIA (na ordem do treino).")
        if not 0.0 < threshold < 1.0:
            raise ValueError("MODEL_THRESHOLD deve estar entre 0 e 1.")
        self.model_path = Path(model_path)
        self.class_names = names  # índice 1 = classe positiva do sigmoid
        self.threshold = float(threshold)
        self.low_confidence = float(low_confidence)
        self.model_version = version or ""
        self.input_size = tuple(settings.MODEL_IMAGE_SIZE)
        self._model = None
        self._tf = None
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()

    # -- estado -------------------------------------------------------------
    @property
    def configured(self):
        return self.model_path.is_file()

    @property
    def loaded(self):
        return self._model is not None

    # -- carregamento -------------------------------------------------------
    def load(self):
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            if not self.model_path.is_file():
                raise ModelNotConfigured(
                    "Serviço de IA não configurado: arquivo do modelo não encontrado. "
                    "Defina MODEL_PATH no backend."
                )
            try:
                import tensorflow as tf
            except ImportError as exc:
                raise ModelNotConfigured("TensorFlow não está instalado no servidor.") from exc

            started = time.perf_counter()
            try:
                model = tf.keras.models.load_model(self.model_path, compile=False)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Falha ao carregar o modelo %s", self.model_path)
                raise ModelNotConfigured(
                    "Falha ao carregar o modelo CNN (verifique a versão do Keras/TensorFlow)."
                ) from exc

            self._tf = tf
            self._read_input_size(model)
            self._model = model
            try:
                # Aquecimento + validação do formato de saída (1 neurônio sigmoid).
                import numpy as np

                height, width = self.input_size
                self._infer(np.zeros((1, height, width, 3), dtype="float32"))
            except Exception as exc:  # noqa: BLE001
                self._model = None
                logger.exception("Modelo carregado, mas incompatível")
                raise ModelNotConfigured(
                    "Modelo incompatível: esperado 1 saída sigmoid e entrada RGB."
                ) from exc

            if not self.model_version:
                self.model_version = f"{self.model_path.stem}@{self._sha256()[:8]}"
            logger.info(
                "Modelo %s carregado em %.1fs (entrada %s, limiar %.2f)",
                self.model_version,
                time.perf_counter() - started,
                self.input_size,
                self.threshold,
            )

    def _read_input_size(self, model):
        try:
            shape = model.input_shape
            if isinstance(shape, list):
                shape = shape[0]
            height, width = shape[1], shape[2]
            if height and width:
                self.input_size = (int(height), int(width))
        except Exception:  # noqa: BLE001 - mantém o padrão de settings.MODEL_IMAGE_SIZE
            pass

    def _sha256(self):
        digest = hashlib.sha256()
        with self.model_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    # -- inferência ---------------------------------------------------------
    def _preprocess(self, image_bytes):
        tf = self._tf
        try:
            image = tf.io.decode_image(image_bytes, channels=3, expand_animations=False)
        except Exception as exc:  # noqa: BLE001
            raise InferenceError("Não foi possível decodificar a imagem.") from exc
        image = tf.image.resize(image, self.input_size, method="bilinear")
        image = tf.cast(image, tf.float32) / 255.0
        return tf.expand_dims(image, 0)

    def _infer(self, batch):
        import numpy as np

        with self._infer_lock:  # um predict por vez por processo; use mais workers para paralelismo
            output = self._model(batch, training=False)
        values = np.asarray(output).reshape(-1)
        if values.size != 1:
            raise InferenceError("Saída do modelo incompatível (esperado 1 neurônio sigmoid).")
        probability = float(values[0])
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise InferenceError("Saída do modelo fora do intervalo [0, 1].")
        return probability

    def predict(self, image_bytes: bytes) -> Prediction:
        self.load()
        started = time.perf_counter()
        probability = self._infer(self._preprocess(image_bytes))
        positive = probability > self.threshold
        confidence = probability if positive else 1.0 - probability
        return Prediction(
            label=self.class_names[1] if positive else self.class_names[0],
            probability_pneumonia=probability,
            confidence=confidence,
            low_confidence=confidence < self.low_confidence,
            threshold=self.threshold,
            model_version=self.model_version,
            inference_ms=int((time.perf_counter() - started) * 1000),
        )


# --------------------------------------------------------------------------
# Instância única por processo (cada worker do gunicorn carrega a sua)
# --------------------------------------------------------------------------
_classifier = None
_classifier_lock = threading.Lock()


def get_classifier() -> PneumoniaClassifier:
    global _classifier
    if _classifier is None:
        with _classifier_lock:
            if _classifier is None:
                _classifier = PneumoniaClassifier(
                    settings.MODEL_PATH,
                    class_names=settings.MODEL_CLASS_NAMES,
                    threshold=settings.MODEL_THRESHOLD,
                    low_confidence=settings.MODEL_LOW_CONFIDENCE,
                    version=settings.MODEL_VERSION,
                )
    return _classifier


def reset_classifier():
    """Descarta a instância (testes / recarga do modelo após trocar o arquivo)."""
    global _classifier
    with _classifier_lock:
        _classifier = None


def get_status():
    classifier = get_classifier()
    return {
        "configured": classifier.configured,
        "loaded": classifier.loaded,
        "model_file": classifier.model_path.name,
        "model_version": classifier.model_version or None,
        "class_names": classifier.class_names,
        "threshold": classifier.threshold,
        "input_size": list(classifier.input_size),
    }
