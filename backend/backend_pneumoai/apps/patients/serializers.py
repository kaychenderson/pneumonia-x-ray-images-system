import re

from django.utils import timezone
from rest_framework import serializers

from apps.core.utils import initials

from .models import Patient

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9\-_.]{2,19}$")


def format_phone(value):
    """Normaliza telefone brasileiro para (DD)NNNNN-NNNN (celular) ou (DD)NNNN-NNNN (fixo).

    Aceita digitação livre ("84981236789", "(84) 98123-6789", "+55 84 98123-6789").
    Levanta ValueError se não houver DDD + número válidos.
    """
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("55") and len(digits) in (12, 13):
        digits = digits[2:]  # remove o código do país
    if len(digits) == 11 and digits[2] == "9":
        return f"({digits[:2]}){digits[2:7]}-{digits[7:]}"
    if len(digits) == 10 and digits[2] != "0":
        return f"({digits[:2]}){digits[2:6]}-{digits[6:]}"
    raise ValueError("invalid phone")


class PatientSummarySerializer(serializers.ModelSerializer):
    initials = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = ("id", "code", "full_name", "initials", "birth_date", "age")
        read_only_fields = fields

    def get_initials(self, obj):
        return initials(obj.full_name)


class PatientSerializer(serializers.ModelSerializer):
    code = serializers.CharField(required=False, allow_blank=True, max_length=20)
    initials = serializers.SerializerMethodField()
    age = serializers.IntegerField(read_only=True)
    exams_count = serializers.SerializerMethodField()
    last_exam_at = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = (
            "id",
            "code",
            "full_name",
            "initials",
            "birth_date",
            "age",
            "phone",
            "email",
            "notes",
            "exams_count",
            "last_exam_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_initials(self, obj):
        return initials(obj.full_name)

    def get_exams_count(self, obj):
        value = getattr(obj, "exams_count", None)
        return value if value is not None else obj.exams.count()

    def get_last_exam_at(self, obj):
        value = getattr(obj, "last_exam_at", None)
        if value is None and not hasattr(obj, "exams_count"):
            last = obj.exams.order_by("-created_at").first()
            value = last.created_at if last else None
        return serializers.DateTimeField().to_representation(value) if value else None

    def validate_full_name(self, value):
        value = " ".join(value.split())
        if len(value) < 3:
            raise serializers.ValidationError("Informe o nome completo.")
        return value

    def validate_birth_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("A data de nascimento não pode ser futura.")
        if value.year < 1900:
            raise serializers.ValidationError("Data de nascimento inválida.")
        return value

    def validate_code(self, value):
        value = value.strip().upper()
        if not value:
            return value
        if not CODE_RE.match(value):
            raise serializers.ValidationError("Use letras maiúsculas, números e hífen (ex.: PAC-00482).")
        qs = Patient.objects.filter(code=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Já existe um paciente com esta identificação.")
        return value

    def validate_phone(self, value):
        value = value.strip()
        if not value:
            return value
        try:
            return format_phone(value)
        except ValueError:
            raise serializers.ValidationError(
                "Telefone inválido. Informe o DDD e o número, ex.: (84)98123-6789."
            ) from None

    def update(self, instance, validated_data):
        if not validated_data.get("code"):
            validated_data.pop("code", None)  # não apaga a identificação existente
        return super().update(instance, validated_data)
