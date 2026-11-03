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