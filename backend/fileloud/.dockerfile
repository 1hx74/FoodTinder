FROM python:3.11-slim
WORKDIR /app
# context = ./backend/fileloud
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "files:app", "--host", "0.0.0.0", "--port", "8000"]
