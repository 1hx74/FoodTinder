import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

# --- DB
POSTGRES_USER = os.environ["POSTGRES_USER"]
POSTGRES_PASSWORD = os.environ["POSTGRES_PASSWORD"]
POSTGRES_DB = os.environ["POSTGRES_DB"]
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")

DB_URL = (
    f"postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

# --- Security
PEPPER_KEY = os.environ.get("PEPPER_KEY", "change_me_in_production_please")

# RS256: приватный ключ в PEM — либо прямо в env (с \n), либо путём к файлу.
# Если ничего не задано — при старте генерируется временный ключ (только для dev!).
JWT_PRIVATE_KEY_PEM = os.environ.get("JWT_PRIVATE_KEY_PEM")
JWT_PRIVATE_KEY_PATH = os.environ.get("JWT_PRIVATE_KEY_PATH")

JWT_ISSUER = "food-tinder-jwt-vendor"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)

COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
REFRESH_COOKIE_NAME = "refresh-token"

# --- Email verification (сервис email_verificator, только внутри docker-сети)
EMAIL_VERIFICATOR_URL = os.environ.get(
    "EMAIL_VERIFICATOR_URL", "http://email_verificator:8000"
).rstrip("/")
# сколько живёт незавершённая регистрация / смена пароля (ждёт код с почты), сек
PENDING_TTL = timedelta(seconds=int(os.environ.get("PENDING_TTL", "900")))

# --- Служебный аккаунт (задаётся в .env в КОРНЕ проекта, прокидывается через compose)
# Если email или пароль пустые — аккаунт не создаётся.
SERVICE_ADMIN_EMAIL = os.environ.get("SERVICE_ADMIN_EMAIL", "").strip()
SERVICE_ADMIN_PASSWORD = os.environ.get("SERVICE_ADMIN_PASSWORD", "").strip()
