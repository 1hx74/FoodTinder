import os
import smtplib

from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header
from dotenv import load_dotenv


load_dotenv()

# FoodTinder: .get() вместо [] — пустые/не заданные GMAIL/APP_PASSWORD включают dev-режим (см. ниже)
GMAIL = os.environ.get("GMAIL", "").strip()
APP_PASSWORD = os.environ.get("APP_PASSWORD", "").strip()

CODE_TTL = int(os.environ["CODE_TTL"])
HTML_FILE = Path(__file__).parent / "verification.html"
HTML_TEMPLATE = HTML_FILE.read_text(encoding="utf-8")


def send_email(to: str, code: str):
    ttl_minutes = str(int(CODE_TTL / 60))

    # --- FoodTinder: DEV-РЕЖИМ ---------------------------------------------
    # Если почта не настроена (GMAIL или APP_PASSWORD пустые) — письмо не шлём,
    # а печатаем код в лог: docker compose logs email_verificator
    if not GMAIL or not APP_PASSWORD:
        print(f"[DEV MODE] GMAIL не задан, письмо не отправлено. "
              f"Код для {to}: {code} (действует {ttl_minutes} мин)", flush=True)
        return
    # ------------------------------------------------------------------------

    body = HTML_TEMPLATE.replace("{{CODE}}", code).replace("{{TTL}}", ttl_minutes)

    msg = MIMEMultipart("alternative")

    msg["From"] = GMAIL
    msg["To"] = to
    msg["Subject"] = Header("Код подтверждения", "utf-8")

    text = f"Ваш код подтверждения: {code}\nКод действителен {ttl_minutes} минут."

    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(body, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL, APP_PASSWORD)
        smtp.send_message(msg)