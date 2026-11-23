import hashlib

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.audit.actions import Actions
from apps.audit.services import log_event

from .avatar import process_avatar
from .models import Role, User, default_preferences


def run_password_validators(password, user=None):
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return password


# --------------------------------------------------------------------------
# Leitura
# --------------------------------------------------------------------------
class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "registration", "specialty")
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "name",
            "email",
            "role",
            "registration",
            "specialty",
            "avatar_url",
            "is_active",
            "date_joined",
            "last_login",
        )
        read_only_fields = fields

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        version = hashlib.sha256(obj.avatar.name.encode()).hexdigest()[:8]
        url = f"{reverse('user-avatar', args=[obj.pk])}?v={version}"
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url


# --------------------------------------------------------------------------
# Login
# --------------------------------------------------------------------------
class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        request = self.context.get("request")
        email = (attrs.get(self.username_field) or "").strip().lower()
        attrs[self.username_field] = email
        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            log_event(request, Actions.LOGIN_FAILED, email=email)
            # Só revela "inativa" a quem comprovou a senha (evita enumeração de contas).
            user = User.objects.filter(email__iexact=email).first()
            if user and not user.is_active and user.check_password(attrs.get("password", "")):
                raise AuthenticationFailed(
                    "Conta inativa ou aguardando aprovação do administrador.",
                    code="inactive_account",
                ) from None
            raise
        log_event(request, Actions.LOGIN, user=self.user)
        data["user"] = UserSerializer(self.user, context=self.context).data
        return data


# --------------------------------------------------------------------------
# Cadastro / senha
# --------------------------------------------------------------------------
class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    registration = serializers.CharField(max_length=40)
    specialty = serializers.CharField(max_length=100)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
        return value

    def validate(self, attrs):
        probe = User(email=attrs["email"], name=attrs["name"])
        try:
            run_password_validators(attrs["password"], probe)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"password": exc.detail}) from exc
        return attrs

    def create(self, validated_data):
        from django.conf import settings

        return User.objects.create_user(
            role=Role.DOCTOR,  # o papel nunca vem do cliente
            is_active=not settings.REGISTRATION_REQUIRES_APPROVAL,
            **validated_data,
        )


class PasswordForgotSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    refresh = serializers.CharField(
        required=False,
        write_only=True,
        help_text="Refresh token da sessão atual: é preservado; as demais sessões são encerradas.",
    )

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Senha atual incorreta.")
        return value

    def validate_new_password(self, value):
        return run_password_validators(value, self.context["request"].user)

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": ["A nova senha deve ser diferente da atual."]}
            )
        return attrs


# --------------------------------------------------------------------------
# Perfil próprio
# --------------------------------------------------------------------------
class MeSerializer(UserSerializer):
    avatar = serializers.ImageField(write_only=True, required=False)
    preferences = serializers.JSONField(required=False)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("avatar", "preferences")
        read_only_fields = (
            "id",
            "role",
            "avatar_url",
            "is_active",
            "date_joined",
            "last_login",
        )

    def validate_email(self, value):
        value = value.strip().lower()
        qs = User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
        return value

    def validate_avatar(self, value):
        return process_avatar(value)

    def validate_preferences(self, value):
        allowed = set(default_preferences())
        if not isinstance(value, dict) or set(value) - allowed:
            raise serializers.ValidationError(f"Chaves permitidas: {sorted(allowed)}.")
        if not all(isinstance(v, bool) for v in value.values()):
            raise serializers.ValidationError("Os valores devem ser verdadeiro/falso.")
        return {**default_preferences(), **(self.instance.preferences or {}), **value}

    def update(self, instance, validated_data):
        avatar = validated_data.pop("avatar", None)
        instance = super().update(instance, validated_data)
        if avatar is not None:
            old_name = instance.avatar.name if instance.avatar else None
            instance.avatar.save("avatar.jpg", avatar, save=True)
            if old_name and old_name != instance.avatar.name:
                instance.avatar.storage.delete(old_name)
        return instance


# --------------------------------------------------------------------------
# Administração de usuários
# --------------------------------------------------------------------------
class AdminUserSerializer(UserSerializer):
    class Meta(UserSerializer.Meta):
        read_only_fields = ("id", "email", "avatar_url", "date_joined", "last_login")

    def validate(self, attrs):
        user = self.instance
        actor = self.context["request"].user
        new_role = attrs.get("role", user.role)
        new_active = attrs.get("is_active", user.is_active)

        if user.pk == actor.pk and (new_role != user.role or new_active != user.is_active):
            raise serializers.ValidationError(
                "Você não pode alterar o próprio perfil de acesso ou status."
            )
        loses_admin = user.role == Role.ADMIN and user.is_active and (
            new_role != Role.ADMIN or not new_active
        )
        if loses_admin and not (
            User.objects.filter(role=Role.ADMIN, is_active=True).exclude(pk=user.pk).exists()
        ):
            raise serializers.ValidationError("É necessário manter ao menos um administrador ativo.")
        return attrs


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Role.choices, default=Role.DOCTOR)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
        return value
