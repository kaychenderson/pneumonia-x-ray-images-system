import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    DOCTOR = "doctor", "Médico"
    ADMIN = "admin", "Administrador"


def default_preferences():
    return {
        "notify_analysis_done": True,
        "notify_pending_reports": True,
        "weekly_summary": True,
    }


def avatar_upload_to(instance, filename):
    # O nome original é descartado (pode conter dados pessoais); o arquivo é reencodado em JPEG.
    return f"avatars/{uuid.uuid4().hex}.jpg"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("O e-mail é obrigatório.")
        user = self.model(email=email.strip().lower(), **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", Role.ADMIN)
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField("e-mail", max_length=254, unique=True)
    name = models.CharField("nome", max_length=150)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.DOCTOR)
    registration = models.CharField("registro profissional", max_length=40, blank=True)  # CRM
    specialty = models.CharField("especialidade", max_length=100, blank=True)
    avatar = models.ImageField(upload_to=avatar_upload_to, null=True, blank=True)
    preferences = models.JSONField(default=default_preferences, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # acesso ao Django admin (independe do role)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name or self.email

    @property
    def is_admin_role(self):
        return self.role == Role.ADMIN
