"""
Django settings for tapal_backend project.
"""

from datetime import timedelta
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from repo root and/or tapal_backend/ (GROQ_API_KEY, etc.)
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR.parent / '.env')
    load_dotenv(BASE_DIR / '.env')
    # Firebase web keys (VITE_FIREBASE_*) live in the frontend's .env; the push settings below read them.
    load_dotenv(BASE_DIR.parent / 'tapal_frontend' / '.env')
except ImportError:
    pass

def _env_list(name: str, default: str = '') -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(',') if item.strip()]


# Local development keeps working with no settings. On the server set DJANGO_DEBUG=0 and the
# values in deploy/backend.env.example.
DEBUG = os.environ.get('DJANGO_DEBUG', '1').lower() in ('1', 'true', 'yes')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('Set DJANGO_SECRET_KEY on the server (see deploy/backend.env.example).')
    SECRET_KEY = 'django-insecure-$x_l0#i-j2is28g=#w=47e3z6ai+)@k$+rlhf054^u0ap0k^ap'

ALLOWED_HOSTS = _env_list('DJANGO_ALLOWED_HOSTS', '*')
CSRF_TRUSTED_ORIGINS = _env_list('DJANGO_CSRF_TRUSTED_ORIGINS')

# Behind the frontend server / nginx: trust its X-Forwarded-Proto so links use https.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

# Set DJANGO_HTTPS=1 once the site is served over https (after the certificate is installed).
if os.environ.get('DJANGO_HTTPS', '0').lower() in ('1', 'true', 'yes'):
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_HSTS_SECONDS', '3600'))

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'djoser',
    'core',
    'api',
]

AUTH_USER_MODEL = 'core.User'

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'tapal_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'tapal_backend.wsgi.application'

# MySQL (AWS RDS) when DB_HOST is set in .env; otherwise the local SQLite file.

# DATABASES = {
#         'default': {
#             'ENGINE': 'django.db.backends.sqlite3',
#             'NAME': os.environ.get('DJANGO_SQLITE_PATH', str(BASE_DIR / 'db.sqlite3')),
#             'OPTIONS': {'timeout': 20},  # several server workers share one SQLite file
#         }
#     }

DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.environ.get('DB_NAME', ''),
            'USER': os.environ.get('DB_USER', ''),
            'PASSWORD': os.environ.get('DB_PASSWORD', ''),
            'HOST': os.environ['DB_HOST'],
            'PORT': os.environ.get('DB_PORT', '3306'),
   
        }
    }



# DATABASES = {
#     'default': {
#         'ENGINE': 'django.db.backends.mysql',
#         'NAME': os.environ.get('DB_NAME'),
#         'USER': os.environ.get('DB_USER'),
#         'PASSWORD': os.environ.get('DB_PASSWORD'),
#         'HOST': os.environ.get('DB_HOST'),
#         'PORT': os.environ.get('DB_PORT', '3306'),
#         'OPTIONS': {
#             'connect_timeout': 10,
#         },
#     }
# }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Karachi'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'  # `manage.py collectstatic` (Django admin CSS/JS)

# The frontend calls the API on its own domain, so CORS only matters for other origins.
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = _env_list('DJANGO_CORS_ALLOWED_ORIGINS')

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

SIMPLE_JWT = {
    # Head Office stays signed in for 7 days (the app does not refresh the token in between).
    'ACCESS_TOKEN_LIFETIME': timedelta(days=7),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': False,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

DJOSER = {
    'LOGIN_FIELD': 'email',
    'USER_ID_FIELD': 'id',
    'SERIALIZERS': {
        'user': 'core.serializers.UserSerializer',
        'current_user': 'core.serializers.UserSerializer',
    },
}

MEDIA_URL = '/media/'
# Journey visits send three compressed photos in one request.
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024
MEDIA_ROOT = Path(os.environ.get('DJANGO_MEDIA_ROOT', str(BASE_DIR / 'media')))
# Uploaded photos / videos / QR images are served by Django at /media/ (also when DEBUG is off).
SERVE_MEDIA = os.environ.get('DJANGO_SERVE_MEDIA', '1').lower() in ('1', 'true', 'yes')

# QR codes encode this host path: {SHOPPER_QR_BASE_URL}/shopper/{qr_slug}
SHOPPER_QR_BASE_URL = os.environ.get('SHOPPER_QR_BASE_URL', 'http://localhost:5173')
FRONTEND_SHOPPER_URL = os.environ.get('FRONTEND_SHOPPER_URL', 'http://localhost:5173')
FRONTEND_BASE_URL = os.environ.get('FRONTEND_BASE_URL', 'http://localhost:5173')

# BA Linguistic NLP runs in-process (tapal_backend/ba_engine) — no separate engine server
BRAND_NAME = os.environ.get('BRAND_NAME', 'Tapal')
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
GROQ_CHAT_MODEL = os.environ.get('GROQ_CHAT_MODEL', 'llama-3.3-70b-versatile')
ANSWER_STT_PROVIDER = os.environ.get('ANSWER_STT_PROVIDER', 'groq')
GROQ_STT_MODEL = os.environ.get('GROQ_STT_MODEL', 'whisper-large-v3-turbo')
BA_CERTIFICATION_THRESHOLD = int(os.environ.get('BA_CERTIFICATION_THRESHOLD', '75'))

# Ensure ba_engine / Groq STT see the same env Django loaded
if GROQ_API_KEY:
    os.environ['GROQ_API_KEY'] = GROQ_API_KEY
if OPENAI_API_KEY:
    os.environ['OPENAI_API_KEY'] = OPENAI_API_KEY
os.environ.setdefault('ANSWER_STT_PROVIDER', ANSWER_STT_PROVIDER)
os.environ.setdefault('GROQ_STT_MODEL', GROQ_STT_MODEL)
os.environ.setdefault('BRAND_NAME', BRAND_NAME)

# Supervisor FCM web push (same values the Vite app used as VITE_FIREBASE_*)
FIREBASE_API_KEY = os.environ.get('FIREBASE_API_KEY', os.environ.get('VITE_FIREBASE_API_KEY', ''))
FIREBASE_AUTH_DOMAIN = os.environ.get('FIREBASE_AUTH_DOMAIN', os.environ.get('VITE_FIREBASE_AUTH_DOMAIN', ''))
FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', os.environ.get('VITE_FIREBASE_PROJECT_ID', ''))
FIREBASE_STORAGE_BUCKET = os.environ.get(
    'FIREBASE_STORAGE_BUCKET',
    os.environ.get('VITE_FIREBASE_STORAGE_BUCKET', ''),
)
FIREBASE_MESSAGING_SENDER_ID = os.environ.get(
    'FIREBASE_MESSAGING_SENDER_ID',
    os.environ.get('VITE_FIREBASE_MESSAGING_SENDER_ID', ''),
)
FIREBASE_APP_ID = os.environ.get('FIREBASE_APP_ID', os.environ.get('VITE_FIREBASE_APP_ID', ''))
FIREBASE_VAPID_KEY = os.environ.get('FIREBASE_VAPID_KEY', os.environ.get('VITE_FIREBASE_VAPID_KEY', ''))
FIREBASE_SERVICE_ACCOUNT_PATH = os.environ.get('FIREBASE_SERVICE_ACCOUNT_PATH') or next(
    (
        str(candidate)
        for candidate in (
            BASE_DIR / 'firebase-service-account.json',
            BASE_DIR.parent / 'firebase-service-account.json',
            BASE_DIR.parent / 'tapal_frontend' / 'firebase-service-account.json',
        )
        if candidate.is_file()
    ),
    str(BASE_DIR / 'firebase-service-account.json'),
)
