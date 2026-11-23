FROM python:3.12-slim

# FoodTinder: без буферизации, чтобы print (в т.ч. код в dev-режиме) сразу попадал в docker logs
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# FoodTinder: контекст сборки — сама папка backend/email_verificator
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# FoodTinder: внутри docker-сети слушаем 8000 (как остальные сервисы), PORT задаётся в .env
EXPOSE 8000

CMD ["python", "main.py"]
