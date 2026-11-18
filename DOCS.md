# Swagger (/docs) сервисов

Адреса для локального запуска (`docker compose up --build -d`).

| Сервис    | Контейнер     | Docs                            | Доступ                     | Что делает                                                     |
|-----------|---------------|---------------------------------|----------------------------|----------------------------------------------------------------|
| auth      | ft-auth       | http://localhost:8080/docs      | открыт наружу (порт 8080)  | регистрация, логин, JWT, JWKS (`/api/auth/*`, `/.well-known/`) |
| recipes   | ft-recipes    | http://localhost:8000/docs      | открыт наружу (порт 8000)  | рецепты, лайки/дизлайки/избранное, next (`/api/db/*`)          |
| fileloud  | ft-fileloud   | http://localhost:8001/docs      | только localhost хоста     | хранилище файлов (MinIO + SQLite), напрямую фронтом не используется |
| media     | ft-media      | http://localhost:8002/docs      | только localhost хоста     | аватар, фото рецептов, гипертекст (`/api/db/me/avatar`, `/api/db/avatar/{id}`, `/api/db/image`, `/api/db/hyper-text`) |

Сайт и всё API через nginx: http://localhost (порт 80).

ReDoc у каждого сервиса тоже есть: замени `/docs` на `/redoc`.

MinIO (S3 для fileloud) и Postgres наружу не опубликованы, доступны только внутри docker-сети.

## Адрес сайта (для деплоя)

Публичный адрес задаётся в одном месте: `PUBLIC_BASE_URL` в `.env` в корне проекта
(шаблон в `.env.example`). Можно IP или домен: `http://203.0.113.10`, `https://foodtinder.ru`.
От него собираются ссылки `avatar_url`, `image_url`, `hyper-text`, которые отдаёт бэк.
После изменения: `docker compose up -d --force-recreate media`.
