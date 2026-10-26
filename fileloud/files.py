import os
import uuid
from pathlib import Path
import mimetypes
import aioboto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, HttpUrl

app = FastAPI(title="Fileloud Isolated Microservice")

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")
BUCKET_NAME = os.getenv("BUCKET_NAME")

BASE_URL = os.getenv("BASE_URL")

MAX_FILE_SIZE = 10 * 1024 * 1024

session = aioboto3.Session()


class UploadResponse(BaseModel):
    status: str = "ok"
    url: HttpUrl


class AvatarResponse(BaseModel):
    status: str = "ok"
    avatar_url: HttpUrl


def normalize_filename(filename: str) -> str:
    """
    Нормализуем имя файла, оставляем только расширение и
    созданный uid
    """
    path = Path(filename)
    ext = path.suffix.lower()

    unique_name = uuid.uuid4().hex[:12]
    return f"{unique_name}{ext}"


async def save_file_to_minio(file: UploadFile) -> str:
    """
    Функция для сохранения файла.
    Проверяет на превышение размера, на пустой файл
    Определяет MIME-тип
    Подключается к MinIo и сохраняет файл
    """
    safe_name = normalize_filename(file.filename)
    file_size = file.size if file.size is not None else 0
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Файл пустой.")

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413,
                            detail=f"Файл слишком большой. Максимум {MAX_FILE_SIZE // (1024 * 1024)}MB.")
    content_type = file.content_type
    if not content_type or content_type == "application/octet-stream":
        content_type, _ = mimetypes.guess_type(safe_name)
        content_type = content_type or "application/octet-stream"

    try:
        file_content = await file.read()
        async with session.client(
                "s3",
                endpoint_url=MINIO_ENDPOINT,
                aws_access_key_id=MINIO_ACCESS_KEY,
                aws_secret_access_key=MINIO_SECRET_KEY,
        ) as s3:
            await s3.put_object(
                Bucket=BUCKET_NAME,
                Key=safe_name,
                Body=file_content,
                ContentType=content_type
            )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ["QuotaExceeded", "SlowDown", "InsufficientStorageSpace"]:
            raise HTTPException(status_code=507, detail="Хранилище переполнено.")
        raise HTTPException(status_code=500, detail=f"Ошибка хранилища: {str(e)}")
    finally:
        await file.close()
    return safe_name


@app.on_event("startup")
async def startup_event():
    async with session.client(
            "s3",
            endpoint_url=MINIO_ENDPOINT,
            aws_access_key_id=MINIO_ACCESS_KEY,
            aws_secret_access_key=MINIO_SECRET_KEY,
    ) as s3:
        try:
            await s3.head_bucket(Bucket=BUCKET_NAME)
        except ClientError:
            await s3.create_bucket(Bucket=BUCKET_NAME)


@app.post("/api/v1/files/upload", response_model=UploadResponse, status_code=status.HTTP_200_OK)
async def upload_file(file: UploadFile = File(...)):
    """
    Универсальная загрузка любого файла
    """
    safe_name = await save_file_to_minio(file)
    file_url = f"{BASE_URL}/public-media/{safe_name}"
    return UploadResponse(url=file_url)


@app.get("/public-media/{filename}")
async def get_file(filename: str):
    """
    Достает файл из MinIO и отдает его в браузер
    """
    async with session.client(
            "s3",
            endpoint_url=MINIO_ENDPOINT,
            aws_access_key_id=MINIO_ACCESS_KEY,
            aws_secret_access_key=MINIO_SECRET_KEY,
    ) as s3:
        try:
            s3_object = await s3.get_object(Bucket=BUCKET_NAME, Key=filename)
            return StreamingResponse(
                s3_object["Body"],
                media_type=s3_object["ContentType"]
            )
        except ClientError as e:
            if e.response.get("Error", {}).get("Code", "") in ["NoSuchKey", "404"]:
                raise HTTPException(status_code=404, detail="Файл не найден")
            raise HTTPException(status_code=500, detail="Ошибка при чтении файла")


@app.post("/api/db/me/avatar", response_model=AvatarResponse, status_code=status.HTTP_200_OK)
async def upload_avatar(file: UploadFile = File(...)):
    """
       Принимает только картинки, возвращает ссылку в поле avatar_url.
       """
    content_type = file.content_type or ""
    extension = Path(file.filename or "").suffix.lower()

    is_image_mime = content_type.startswith("image/")
    is_image_ext = extension in [".jpg", ".jpeg", ".png", ".webp", ".gif"]

    if not (is_image_mime or is_image_ext):
        raise HTTPException(status_code=400, detail="Разрешены только изображения (jpg, png, webp, gif).")

    safe_name = await save_file_to_minio(file)
    file_url = f"{BASE_URL}/public-media/{safe_name}"
    return AvatarResponse(avatar_url=file_url)


@app.get("/api/db/recipes/{id}")
async def get_recipe(id: int):
    """
    Возвращает JSON с HTML-разметкой в поле hyper-text
    """
    return {
        "id": id,
        "title": "Рецепт ...",
        "hyper-text": f"<h1>Рецепт №{id}</h1><p>Описание...</p>"
    }
