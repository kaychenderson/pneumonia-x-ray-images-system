import logging

from django.contrib.auth.tokens import default_token_generator
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import generics, mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.audit.actions import Actions
from apps.audit.services import log_event
from apps.core.permissions import IsAdminRole
from apps.core.renderers import PassthroughRenderer

from .emails import send_invite_email, send_password_reset_email
from .models import User
from .serializers import (
    AdminUserSerializer,
    InviteSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordChangeSerializer,
    PasswordForgotSerializer,
    PasswordResetSerializer,
    RegisterSerializer,
    UserSerializer,
    run_password_validators,
)
from .tokens import revoke_user_tokens

logger = logging.getLogger(__name__)


class LoginView(TokenObtainPairView):
    """POST {email, password} -> {access, refresh, user}."""

    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(APIView):
    """POST {refresh}: invalida o refresh token. Aceita token de acesso expirado."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        refresh = request.data.get("refresh")
        if refresh:
            try:
                token = RefreshToken(refresh)
                user = User.objects.filter(pk=token["user_id"]).first()
                token.blacklist()
                log_event(request, Actions.LOGOUT, user=user)
            except TokenError:
                pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class RegisterView(APIView):
    """Solicitação de cadastro médico. O papel é sempre 'doctor'."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_event(request, Actions.REGISTER, user=user, approved=user.is_active)
        payload = {
            "requires_approval": not user.is_active,
            "detail": (
                "Cadastro recebido. Aguarde a aprovação de um administrador."
                if not user.is_active
                else "Conta profissional criada."
            ),
        }
        if user.is_active:
            refresh = RefreshToken.for_user(user)
            payload.update(
                access=str(refresh.access_token),
                refresh=str(refresh),
                user=UserSerializer(user, context={"request": request}).data,
            )
        return Response(payload, status=status.HTTP_201_CREATED)


class PasswordForgotView(APIView):
    """Sempre responde 200 (não revela se o e-mail existe)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            try:
                send_password_reset_email(user)
            except Exception:  # noqa: BLE001
                logger.exception("Falha ao enviar e-mail de recuperação")
            log_event(request, Actions.PASSWORD_RESET_REQUEST, user=user)
        return Response({"detail": "Se o e-mail estiver cadastrado, enviaremos as instruções."})


class PasswordResetView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invalid = Response(
            {"detail": "Link inválido ou expirado.", "code": "invalid_token"},
            status=status.HTTP_400_BAD_REQUEST,
        )
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(data["uid"])), is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return invalid
        if not default_token_generator.check_token(user, data["token"]):
            return invalid
        try:
            run_password_validators(data["new_password"], user)
        except serializers.ValidationError as exc:
            return Response({"new_password": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        revoke_user_tokens(user)
        log_event(request, Actions.PASSWORD_RESET, user=user)
        return Response({"detail": "Senha redefinida com sucesso."})


class PasswordChangeView(APIView):
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        revoke_user_tokens(user, keep_refresh=serializer.validated_data.get("refresh"))
        log_event(request, Actions.PASSWORD_CHANGE, user=user)
        return Response({"detail": "Senha alterada. As outras sessões foram encerradas."})


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH do perfil. Para trocar a foto, envie multipart com o campo `avatar`."""

    serializer_class = MeSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        serializer.save()
        log_event(
            self.request,
            Actions.PROFILE_UPDATE,
            self.request.user,
            fields=sorted(serializer.validated_data.keys()),
        )


class MeAvatarView(APIView):
    """DELETE: remove a foto de perfil."""

    def delete(self, request):
        user = request.user
        if user.avatar:
            name = user.avatar.name
            user.avatar = None
            user.save(update_fields=["avatar"])
            User._meta.get_field("avatar").storage.delete(name)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AvatarView(APIView):
    """GET autenticado da foto de um profissional (o front deve buscar com o header Authorization)."""

    renderer_classes = [PassthroughRenderer]

    def get(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if not user.avatar:
            raise Http404
        response = FileResponse(user.avatar.open("rb"), content_type="image/jpeg")
        response["Cache-Control"] = "private, max-age=3600"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Gestão de usuários (somente administradores). Não há exclusão: desative o usuário."""

    queryset = User.objects.all()
    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminRole]
    http_method_names = ["get", "patch", "post", "head", "options"]
    filterset_fields = ["role", "is_active"]
    search_fields = ["name", "email", "registration"]
    ordering_fields = ["name", "email", "date_joined", "last_login"]
    ordering = ["name"]

    def perform_update(self, serializer):
        previous = {"role": serializer.instance.role, "is_active": serializer.instance.is_active}
        user = serializer.save()
        if not user.is_active or user.role != previous["role"]:
            revoke_user_tokens(user)  # força novo login com as permissões atuais
        log_event(
            self.request,
            Actions.USER_UPDATE,
            user,
            changed=sorted(serializer.validated_data.keys()),
            previous=previous,
        )

    @action(detail=False, methods=["post"])
    def invite(self, request):
        """Cria o usuário (sem senha) e envia e-mail para ele definir a senha."""
        serializer = InviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        email = data["email"]
        user = User.objects.create_user(
            email=email,
            password=None,
            name=data.get("name") or email.split("@")[0],
            role=data["role"],
        )
        email_sent = True
        try:
            send_invite_email(user, request.user)
        except Exception:  # noqa: BLE001
            logger.exception("Falha ao enviar convite")
            email_sent = False
        log_event(request, Actions.USER_INVITE, user, role=user.role, email_sent=email_sent)
        return Response(
            {"user": AdminUserSerializer(user, context={"request": request}).data, "email_sent": email_sent},
            status=status.HTTP_201_CREATED,
        )

