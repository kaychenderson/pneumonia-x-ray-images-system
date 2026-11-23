from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


def build_reset_link(user, *, invite=False):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    base = settings.FRONTEND_URL.rstrip("/")
    link = f"{base}/reset-password?uid={uid}&token={token}"
    return f"{link}&invite=1" if invite else link


def send_password_reset_email(user):
    link = build_reset_link(user)
    hours = max(1, settings.PASSWORD_RESET_TIMEOUT // 3600)
    send_mail(
        subject="PneumoAI - Recuperação de acesso",
        message=(
            f"Olá, {user.name}.\n\n"
            "Recebemos uma solicitação para redefinir a senha da sua conta PneumoAI.\n"
            f"Use o link abaixo (válido por {hours}h):\n\n{link}\n\n"
            "Se você não fez essa solicitação, ignore este e-mail."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


def send_invite_email(user, invited_by):
    link = build_reset_link(user, invite=True)
    hours = max(1, settings.PASSWORD_RESET_TIMEOUT // 3600)
    send_mail(
        subject="PneumoAI - Convite de acesso",
        message=(
            f"Olá.\n\n{invited_by.name} convidou você para a plataforma PneumoAI "
            f"como {user.get_role_display().lower()}.\n"
            f"Defina sua senha pelo link abaixo (válido por {hours}h):\n\n{link}\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )
