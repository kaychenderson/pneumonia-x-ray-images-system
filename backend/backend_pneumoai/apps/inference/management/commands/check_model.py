from django.core.management.base import BaseCommand, CommandError

from apps.inference.service import InferenceError, ModelNotConfigured, get_classifier


class Command(BaseCommand):
    help = "Carrega o modelo .keras, valida o formato e (opcionalmente) classifica uma imagem."

    def add_arguments(self, parser):
        parser.add_argument("--image", help="Caminho de uma radiografia PNG/JPEG para testar.")

    def handle(self, *args, **options):
        classifier = get_classifier()
        self.stdout.write(f"Arquivo: {classifier.model_path}")
        try:
            classifier.load()
        except ModelNotConfigured as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"OK - versão {classifier.model_version}, entrada {classifier.input_size}, "
                f"classes {classifier.class_names}, limiar {classifier.threshold}"
            )
        )
        if options["image"]:
            with open(options["image"], "rb") as handle:
                payload = handle.read()
            try:
                result = classifier.predict(payload)
            except InferenceError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write(
                f"{result.label}  P(pneumonia)={result.probability_pneumonia:.4f}  "
                f"confiança={result.confidence:.4f}  {result.inference_ms} ms"
            )
