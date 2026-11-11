import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
import aioboto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, HTMLResponse

DB_PATH = "/data/database.db"
os.makedirs("/data", exist_ok=True)

S3_ENDPOINT = os.environ["S3_ENDPOINT"]
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
BUCKET_NAME = os.environ["S3_BUCKET"]
BASE_URL = os.environ["BASE_URL"]

s3_session = aioboto3.Session()

def get_s3_client():
    """Создаёт асинхронный S3-клиент с настройками из окружения."""
    return s3_session.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
    )

def init_db():
    """Создаёт таблицу items, если её нет."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            type TEXT,
            s3_key TEXT,
            content_type TEXT
        )
    """)
    conn.commit()
    conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """При старте: инициализирует БД и создаёт бакет, если его нет."""
    init_db()
    async with get_s3_client() as s3:
        try:
            await s3.head_bucket(Bucket=BUCKET_NAME)
        except ClientError:
            await s3.create_bucket(Bucket=BUCKET_NAME)
    yield

app = FastAPI(lifespan=lifespan)
BASE_URL = os.getenv("BASE_URL", "http://localhost:8001")

@app.post("/media/images")
async def upload_image(file: UploadFile = File(...)):
    """Загружает картинку в S3, сохраняет сведения в БД, возвращает URL."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Нужно загрузить картинку")

    item_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    s3_key = f"images/{item_id}{ext}"

    try:
        async with get_s3_client() as s3:
            await s3.upload_fileobj(
                file.file,
                BUCKET_NAME,
                s3_key,
                ExtraArgs={"ContentType": file.content_type}
            )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ("XMinioStorageFull", "InsufficientStorage"):
            raise HTTPException(status_code=507, detail="Недостаточно места в хранилище")
        raise HTTPException(status_code=502, detail="Ошибка при загрузке файла в S3")

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO items (id, type, s3_key, content_type) VALUES (?, ?, ?, ?)",
            (item_id, "image", s3_key, file.content_type)
        )
        conn.commit()
    except sqlite3.OperationalError:
        raise HTTPException(status_code=507, detail="Ошибка базы данных или нехватка места на диске")
    finally:
        conn.close()

    return {"url": f"{BASE_URL}/uploads/{item_id}"}

@app.post("/media/texts")
async def upload_text(html_content: str = Form(...)):
    """Загружает HTML-текст в S3, сохраняет сведения в БД, возвращает URL."""
    if not html_content.strip():
        raise HTTPException(status_code=400, detail="HTML-контент не может быть пустым")
    item_id = str(uuid.uuid4())
    s3_key = f"texts/{item_id}.html"
    try:
        async with get_s3_client() as s3:
            await s3.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=html_content.encode("utf-8"),
                ContentType="text/html; charset=utf-8"
            )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ("XMinioStorageFull", "InsufficientStorage"):
            raise HTTPException(status_code=507, detail="Недостаточно места в хранилище")
        raise HTTPException(status_code=502, detail="Ошибка при сохранении текста в S3")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO items (id, type, s3_key, content_type) VALUES (?, ?, ?, ?)",
            (item_id, "text", s3_key, "text/html")
        )
        conn.commit()

    except sqlite3.OperationalError:
        raise HTTPException(status_code=507, detail="Ошибка базы данных или нехватка места на диске")
    finally:
        conn.close()

    return {"url": f"{BASE_URL}/uploads/{item_id}"}

@app.get("/uploads/{item_id}")
async def get_item(item_id: str):
    """
        Возвращает ранее загруженный объект по его id
    """

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT type, s3_key, content_type FROM items WHERE id = ?", (item_id,))
        row = cursor.fetchone()
    except sqlite3.Error:
        raise HTTPException(status_code=500, detail="Ошибка чтения базы данных")
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Объект не найден")

    item_type, s3_key, content_type = row

    try:
        async with get_s3_client() as s3:
            s3_response = await s3.get_object(Bucket=BUCKET_NAME, Key=s3_key)
            file_data = await s3_response["Body"].read()
    except ClientError:
        raise HTTPException(status_code=404, detail="Файл не найден в S3 хранилище")

    if item_type == "image":
        return Response(content=file_data, media_type=content_type)
    elif item_type == "text":
        return HTMLResponse(content=file_data.decode("utf-8"))
