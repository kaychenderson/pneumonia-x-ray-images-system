"""Configurações do PneumoAI. Tudo que varia por ambiente vem de variáveis de ambiente (.env)."""

import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

BASE_DIR = Path(__file__).resolve().parent.parent
if load_dotenv:
    load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


# --------------------------------------------------------------------------
# Núcleo
# --------------------------------------------------------------------------
DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-do-not-use-in-production"
    else:
        raise ImproperlyConfigured(
            "Defina DJANGO_SECRET_KEY (ou DJANGO_DEBUG=True apenas em desenvolvimento)."
        )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
ADMIN_URL = os.environ.get("DJANGO_ADMIN_URL", "admin/")
PLATFORM_VERSION = "1.0.0"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceiros
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # Projeto
    "apps.core",
    "apps.accounts",
    "apps.audit",
    "apps.patients",
    "apps.exams",
    "apps.reports",
    "apps.inference",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------
# Banco, cache
# --------------------------------------------------------------------------
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}

REDIS_URL = os.environ.get("REDIS_URL", "")
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --------------------------------------------------------------------------
# Senhas e localização
# --------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_RESET_TIMEOUT = env_int("PASSWORD_RESET_TIMEOUT_SECONDS", 86400)

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------
# Arquivos estáticos e de mídia
# Imagens clínicas NUNCA são servidas por URL pública: só pelos endpoints autenticados.
# --------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"  # necessário ao FileField, mas não é roteado
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

MAX_XRAY_UPLOAD_MB = env_int("MAX_XRAY_UPLOAD_MB", 15)
MAX_AVATAR_UPLOAD_MB = env_int("MAX_AVATAR_UPLOAD_MB", 5)

# --------------------------------------------------------------------------
# DRF / JWT / documentação
# --------------------------------------------------------------------------
_renderers = ["rest_framework.renderers.JSONRenderer"]
if DEBUG:
    _renderers.append("rest_framework.renderers.BrowsableAPIRenderer")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": _renderers,
    "DEFAULT_PARSER_CLASSES": (
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        "login": "10/min",
        "register": "5/hour",
        "password_reset": "5/hour",
        "analysis": "30/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(hours=env_int("JWT_REFRESH_HOURS", 12)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "PneumoAI API",
    "DESCRIPTION": "Back-end do PneumoAI: pacientes, exames, laudos e inferência da CNN DenseNet121.",
    "VERSION": PLATFORM_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
}
ENABLE_API_DOCS = env_bool("ENABLE_API_DOCS", DEBUG)

# --------------------------------------------------------------------------
# CORS / CSRF / segurança
# --------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "")

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
TRUST_X_FORWARDED_FOR = env_bool("TRUST_X_FORWARDED_FOR", False)

TESTING = "test" in sys.argv

if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True) and not TESTING
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("DJANGO_HSTS_SECONDS", 0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
    if env_bool("DJANGO_BEHIND_PROXY", False):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --------------------------------------------------------------------------
# E-mail (recuperação de senha e convites)
# --------------------------------------------------------------------------
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 25)
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", False)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "PneumoAI <nao-responda@pneumoai.com.br>")

# --------------------------------------------------------------------------
# Regras da aplicação
# --------------------------------------------------------------------------
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
REGISTRATION_REQUIRES_APPROVAL = env_bool("REGISTRATION_REQUIRES_APPROVAL", True)
ANALYZE_ON_CREATE = env_bool("ANALYZE_ON_CREATE", True)

# --------------------------------------------------------------------------
# Modelo de IA (CNN DenseNet121)
# Contrato com o treino (ver training/train_densenet121.py):
#   - entrada 224x224 RGB, pixels / 255.0 (sem preprocess_input do DenseNet)
#   - saída sigmoid = P(PNEUMONIA); classes em ordem alfabética: [NORMAL, PNEUMONIA]
# --------------------------------------------------------------------------
_model_path = Path(os.environ.get("MODEL_PATH", "ml_models/modelDenseNet121_Pneumonia.keras"))
MODEL_PATH = _model_path if _model_path.is_absolute() else BASE_DIR / _model_path
MODEL_VERSION = os.environ.get("MODEL_VERSION", "")
MODEL_CLASS_NAMES = [c.upper() for c in env_list("MODEL_CLASS_NAMES", "NORMAL,PNEUMONIA")]
MODEL_THRESHOLD = env_float("MODEL_THRESHOLD", 0.5)
MODEL_LOW_CONFIDENCE = env_float("MODEL_LOW_CONFIDENCE", 0.70)
MODEL_IMAGE_SIZE = (224, 224)  # usado só se o .keras não informar o input_shape

# --------------------------------------------------------------------------
# Logs
# --------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"default": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "default"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
