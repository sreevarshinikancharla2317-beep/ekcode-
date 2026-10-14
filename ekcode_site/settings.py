"""EkCode settings. Deploy-time values come from environment variables."""
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    return os.environ.get(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = ['https://ekcode-sih-production.up.railway.app']
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions",
    "django.contrib.messages", "core", "django.contrib.staticfiles", "rest_framework", "accounts",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware", "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware", "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware", "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware", "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "ekcode_site.urls"
WSGI_APPLICATION = "ekcode_site.wsgi.application"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [BASE_DIR / "templates"], "APP_DIRS": True,
    "OPTIONS": {"context_processors": ["django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
                                       "django.contrib.messages.context_processors.messages"]},
}]

# SQL database: SQLite by default, PostgreSQL with DATABASE_URL=postgres://user:pass@host:5432/ekcode
DATABASES = {"default": dj_database_url.config(default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60)}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}}]
LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage" if not DEBUG
                    else "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}
SESSION_COOKIE_AGE = 7 * 24 * 3600
# Own cookie names: browsers share cookies across ports, and KindBytes runs on the same computer.
SESSION_COOKIE_NAME = "ekcode_sessionid"
CSRF_COOKIE_NAME = "ekcode_csrftoken"

# Demo: show the one-time code on screen instead of sending an SMS. Set EK_DEMO_OTP=0 when an SMS gateway is wired in.
EK_DEMO_OTP = env_bool("EK_DEMO_OTP", True)
EK_LOCK_AFTER = 5          # failed passwords before a lock
EK_LOCK_SECONDS = 30
EK_OTP_SECONDS = 120

if not DEBUG:
    SESSION_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", True)
    CSRF_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    if env_bool("DJANGO_HTTPS", False):          # behind HTTPS: redirect plain http and send HSTS
        SECURE_SSL_REDIRECT = True
        SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "31536000"))
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True
        SECURE_HSTS_PRELOAD = True

LOGGING = {"version": 1, "disable_existing_loggers": False, "handlers": {"console": {"class": "logging.StreamHandler"}},
           "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")}}
