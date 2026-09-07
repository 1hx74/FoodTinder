FROM python:3.12-slim

WORKDIR /app

# RUN apt-get update && apt-get install -y --no-install-recommends \
#     gcc \
#     libpq-dev \
#     && rm -rf /var/lib/apt/lists/*

COPY auth/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY auth/ .

EXPOSE 8000

CMD ["python", "auth.py"]