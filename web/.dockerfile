FROM python:3.12-slim

WORKDIR /app

COPY web/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY web/ .

EXPOSE 8000

CMD ["python", "server.py"]