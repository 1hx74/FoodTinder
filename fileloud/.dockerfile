FROM python:3.11-slim
WORKDIR /app
COPY ./fileloud/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ./fileloud/ .
EXPOSE 8000
CMD ["uvicorn", "files:app", "--host", "0.0.0.0", "--port", "8000"]
