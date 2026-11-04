"""
ФАЙЛ: mock_server.py
-------------------
НАЗНАЧЕНИЕ:
Этот файл является центральным сервером симуляции (мокирующим бэкендом),
написанным на фреймворке FastAPI. Он решает две главные задачи проекта:

1. ФУНКЦИОНАЛ API-ШЛЮЗА:
   Предоставляет реальные сетевые эндпоинты (например, `/api/auth/register`), чтобы
   принимать отправленные формы из фронтенд-файлов JavaScript, валидировать входящие
   JSON-данные по строгим схемам и возвращать клиенту успешные контракты сессий.

2. ЕДИНАЯ ТОЧКА РАЗДАЧИ ФРОНТЕНДА (ХОСТИНГ СТАТИКИ):
   Вместо запуска HTML-страниц напрямую через локальный дисковый протокол браузера (file:///),
   этот сервер сам раздает все папки приложения ('glavnaya', 'registration', 'vxod').
   Такой подход полностью устраняет ошибки безопасности браузера, связанные с кросс-доменными
   запросами (CORS), создавая полноценную рабочую среду, идентичную реальному продакшену.
"""

import logging
from pathlib import Path
from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Подключаемся напрямую к логгеру запущенного воркера Uvicorn,
# чтобы системные обработчики не перехватывали наши сообщения.
logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# Динамически вычисляем корневой каталог проекта относительно места сборки этого скрипта.
BASE_DIR = Path(__file__).resolve().parent

# 1. ПОЛИТИКА КРОСС-ДОМЕННОЙ БЕЗОПАСНОСТИ (НАСТРОЙКА CORS)
# Позволяет локальным файлам, инструментам тестирования или сторонним клиентам
# беспрепятственно выполнять сетевые запросы к нашему API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ОБЪЕКТЫ ПЕРЕДАЧИ ДАННЫХ (ТИПИЗАЦИЯ ВХОДЯЩИХ КОНТРАКТОВ DTO)
class RegisterRequest(BaseModel):
    """
    Слой валидации данных Pydantic. Гарантирует строгую проверку типов входящего тела HTTP-запроса.
    Если присланные JSON-свойства не будут соответствовать этим строковым ограничениям (str),
    FastAPI автоматически заблокирует запрос и вернет клиенту ошибку 422 Unprocessable Entity.
    """
    email: str
    username: str
    password: str

class SendCodeRequest(BaseModel):
    email: str

class VerifyCodeRequest(BaseModel):
    email: str
    code: str

# Контракт строго разделен на 4 независимые категории полей
class PreferencesRequest(BaseModel):
    """Контракт валидации для сохранения настроек профиля"""
    allergies: list[str] = []
    diets: list[str] = []
    religions: list[str] = []
    kitchen_equipment: list[str] = []


# ПЕРЕНАПРАВЛЕНИЕ НАВИГАЦИИ ФРОНТЕНДА (ДВИЖОК РЕДИРЕКТОВ)
@app.get("/")
def main_page():
    """
    Перехватывает базовые заходы пользователя на корневой адрес сервера (http://127.0.0.1:8000)
    и отправляет браузеру команду мгновенного перенаправления (HTTP 307 Redirect) в папку главной страницы.
    """
    return RedirectResponse(url="/glavnaya/")


@app.get("/registration")
def registration_page():
    """
    Нормализует вводимые пользователем URL-адреса, прозрачно перенаправляя
    короткие пути на физические директории статических файлов фронтенда.
    """
    return RedirectResponse(url="/registration/")


@app.get("/authentication")
def authentication_page():
    """Перенаправляет на физический индекс внутри папки authentication"""
    return RedirectResponse(url="/authentication/")


# ОБРАБОТКА ДАННЫХ API (СИМУЛЯЦИЯ БИЗНЕС-ЛОГИКИ БЭКЕНДА)
@app.post("/api/auth/register")
def register_user(user: RegisterRequest, response: Response):
    """
    Шаг 1: Принимает первичные данные регистрации. Симулирует отправку кода на почту.
    """
    logger.info("========================================")
    logger.info(f"===> [РЕГИСТРАЦИЯ] Первичные данные получены для: {user.email}")
    logger.info("========================================")

    # Выставляем статус 201 Created — данные успешно кэшированы, ждем код подтверждения
    response.status_code = status.HTTP_201_CREATED
    return {
        "code": 201,
        "state": "Created",
        "message": "Verification code sent to email"
    }


# --- 8. ЭНДПОИНТЫ ДВУХФАКТОРНОГО ПОДТВЕРЖДЕНИЯ И ВОССТАНОВЛЕНИЯ ---

@app.post("/api/auth/send_code")
def send_code(payload: SendCodeRequest, response: Response):
    """Вспомогательный шаг: Повторный запрос проверочного кода на Email"""
    logger.info(f"===> [ВОССТАНОВЛЕНИЕ] Запрос кода на email: {payload.email}")
    
    if "error" in payload.email:
        response.status_code = status.HTTP_404_NOT_FOUND
        return {"code": 404, "state": "Not Found", "message": "User not found"}
        
    response.status_code = status.HTTP_200_OK
    return {"code": 200, "state": "OK"}

@app.post("/api/auth/verify_code")
def verify_code(payload: VerifyCodeRequest, response: Response):
    logger.info("========================================")
    logger.info(f"===> [ВЕРИФИКАЦИЯ] Проверка кода {payload.code} для: {payload.email}")
    logger.info("========================================")
    
    # Сервер проверяет код. Если не совпал — шлет ошибку 400
    if payload.code != "123456":
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"code": 400, "state": "Bad Request", "message": "Invalid code"}
        
    response.status_code = status.HTTP_200_OK
    extracted_username = payload.email.split('@')[0]
    
    # Возвращает токен, который api.js перехватит и положит в localStorage
    return {
        "code": 200,
        "state": "OK",
        "access_token": f"jwt.token.for.{extracted_username}.success",
        "reset_token": f"temporary-token-for-password-reset-via-{payload.email}"
    }


#Эндпоинт теперь логирует и обрабатывает ровно 4 массива
@app.patch("/api/db/me/preferences")
def update_user_preferences(payload: PreferencesRequest, response: Response):
    """
    Принимает массивы выбранных (красных) кнопок с фронтенда по 4 категориям.
    Если категория пуста, в терминал выведется пустой список [].
    """
    logger.info("========================================")
    logger.info("===> [БЭКЕНД ФИЛТР] Настройки пользователя обновлены!")
    logger.info(f"Аллергии (allergies): {payload.allergies}")
    logger.info(f"Диеты (diets): {payload.diets}")
    logger.info(f"Религия (religions): {payload.religions}")
    logger.info(f"Оборудование (kitchen_equipment): {payload.kitchen_equipment}")
    logger.info("========================================")

    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

# --- 10. ПОЛУЧЕНИЕ НАСТРОЕК ПРОФИЛЯ ПО КОНТРАКТУ GET ---
@app.get("/api/db/me/preferences")
def get_user_preferences(response: Response):
    """
    Имитирует получение сохраненных фильтров пользователя из базы данных сессии.
    Возвращает JSON согласно твоему GET-контракту.
    """
    logger.info("===> [БЭКЕНД ФИЛЬТР] Запрос GET /api/db/me/preferences успешно обработан!")
    
    response.status_code = status.HTTP_200_OK
    
    # Мокаем (симулируем) ответ: пусть по умолчанию будут включены орехи, лактоза, халяль и микроволновка
    return {
        "forbidden": ["nuts", "lactose"],
        "religions": ["halal"],
        "kitchen_equipment": ["microwave", "oven"]
    }


# ДВИЖОК ПОДКЛЮЧЕНИЯ И РАЗДАЧИ СТАТИЧЕСКИХ РЕСУРСОВ
# ВАЖНО: Подключается строго в самом конце файла, выполняя роль фонового перехватчика.
app.mount(
    "/",
    StaticFiles(directory=str(BASE_DIR), html=True),
    name="frontend",
)


if __name__ == "__main__":
    import uvicorn
    # Запускаем локальный uvicorn-воркер на стандартном loopback-интерфейсе 127.0.0.1
    uvicorn.run(app, host="127.0.0.1", port=8000)
