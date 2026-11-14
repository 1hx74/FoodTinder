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

# Глобальная переменная для хранения аватарки в памяти сервера (мок-база данных)
SAVED_AVATAR_DATA = None
SAVED_USERNAME_DATA = "Валерия"

# Подключаемся напрямую к логгеру запущенного воркера Uvicorn,
# чтобы системные обработчики не перехватывали наши сообщения.
logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# Динамически вычисляем корневой каталог проекта относительно места сборки этого скрипта.
BASE_DIR = Path(__file__).resolve().parent

MOCK_RECIPES = {
    1: {
        "recipe_id": 3,
        "image_url": "https://placehold.co/600x400?text=Паста+карбонара",
        "title": "Паста карбонара",
        "description": "Спагетти, бекон, яйцо и пармезан",
        "stars": 5,
        "hyper-text": "https://example.com/recipes/3.html",
        "cooking_time": 25,
        "difficulty": 2,
        "kalories": 520,
        "belki": 22,
        "fats": 24,
        "uglevods": 55,
        "final_weight": 350,
        "ingredients": [
            {"name": "Спагетти", "quantity": "gramm", "count": 200},
            {"name": "Бекон", "quantity": "gramm", "count": 100},
            {"name": "Яичные желтки", "quantity": "item", "count": 3},
            {"name": "Пармезан", "quantity": "gramm", "count": 50}
        ],
        "equipment": ["stove", "pot", "grater"],
        "code": 200,
        "state": "OK"
    },
    2: {
        "recipe_id": 2,
        "image_url": "https://placehold.co/600x400?text=Том+Ям",
        "title": "Том Ям с креветками",
        "description": "Пряный тайский суп с кокосовым молоком",
        "stars": 4,
        "hyper-text": "https://example.com/recipes/2.html",
        "cooking_time": 30,
        "difficulty": 3,
        "kalories": 410,
        "belki": 28,
        "fats": 16,
        "uglevods": 35,
        "final_weight": 400,
        "ingredients": [
            {"name": "Креветки", "quantity": "gramm", "count": 150}
        ],
        "equipment": ["stove", "pot"],
        "code": 200,
        "state": "OK"
    },
    3: {
        "recipe_id": 3,
        "image_url": "https://placehold.co/600x400?text=Сырники",
        "title": "Сырники классические",
        "description": "Нежные творожные сырники с ванилью и сметаной",
        "stars": 5,
        "hyper-text": "https://example.com/recipes/3.html",
        "cooking_time": 20,
        "difficulty": 1,
        "kalories": 350,
        "belki": 24,
        "fats": 18,
        "uglevods": 25,
        "final_weight": 250,
        "ingredients": [
            {"name": "Творог", "quantity": "gramm", "count": 300}
        ],
        "equipment": ["stove", "blender"],
        "code": 200,
        "state": "OK"
    },
    4: {
        "recipe_id": 4,
        "image_url": "https://placehold.co/600x400?text=Лосось",
        "title": "Запечённый лосось",
        "description": "Красная рыба под лимонным соусом в духовке",
        "stars": 4,
        "hyper-text": "https://example.com/recipes/4.html",
        "cooking_time": 25,
        "difficulty": 2,
        "kalories": 480,
        "belki": 34,
        "fats": 22,
        "uglevods": 10,
        "final_weight": 300,
        "ingredients": [
            {"name": "Лосось", "quantity": "gramm", "count": 250}
        ],
        "equipment": ["oven", "backing_dish"],
        "code": 200,
        "state": "OK"
    },
    5: {
        "recipe_id": 5,
        "image_url": "https://placehold.co/600x400?text=Рамен",
        "title": "[ТЕСТ ОШИБКИ 404] Рамен",
        "description": "Тестовая карточка с симуляцией 404 ошибки бэкенда",
        "stars": 3,
        "hyper-text": "https://example.com/recipes/5.html",
        "cooking_time": 40,
        "difficulty": 3,
        "kalories": 550,
        "belki": 20,
        "fats": 20,
        "uglevods": 60,
        "final_weight": 500,
        "ingredients": [],
        "equipment": ["stove"],
        "code": 404,
        "state": "Not Found"
    },
    6: {
        "recipe_id": 6,
        "image_url": "https://placehold.co/600x400?text=Стейк",
        "title": "[ТЕСТ ОШИБКИ 401] Стейк Рибай",
        "description": "Тестовая карточка с симуляцией 401 ошибки авторизации",
        "stars": 5,
        "hyper-text": "https://example.com/recipes/6.html",
        "cooking_time": 15,
        "difficulty": 4,
        "kalories": 700,
        "belki": 45,
        "fats": 40,
        "uglevods": 5,
        "final_weight": 350,
        "ingredients": [],
        "equipment": ["stove"],
        "code": 401,
        "state": "Unauthorized"
    },
}

# 1. ПОЛИТИКА КРОСС-ДОМЕННОЙ БЕЗОПАСНОСТИ (НАСТРОЙКА CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ОБЪЕКТЫ ПЕРЕДАЧИ ДАННЫХ (ТИПИЗАЦИЯ ВХОДЯЩИХ КОНТРАКТОВ DTO)
class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str

class SendCodeRequest(BaseModel):
    email: str

class VerifyCodeRequest(BaseModel):
    email: str
    code: str

class UpdateProfileRequest(BaseModel):
    username: str
    birth_date: str
    gender: str
    height: int
    weight: int
    avatar_url: str | None = None

class NewPasswordRequest(BaseModel):
    reset_token: str
    new_password: str

class PreferencesRequest(BaseModel):
    """Контракт валидации для сохранения настроек профиля (с учётом forbidden вместо старых аллергий)"""
    forbidden: list[str] = []
    religions: list[str] = []
    kitchen_equipment: list[str] = []

NEXT_RECIPE_POINTER = 1
class RecipeReactionRequest(BaseModel):
    recipe_id: int
    action: str

@app.get("/swipe")
def swipe_page():
    return RedirectResponse(url="/swipe/")


@app.get("/")
def main_page():
    return RedirectResponse(url="/glavnaya/")


@app.get("/registration")
def registration_page():
    return RedirectResponse(url="/registration/")


@app.get("/authentication")
def authentication_page():
    return RedirectResponse(url="/authentication/")


# ОБРАБОТКА ДАННЫХ API
@app.post("/api/auth/register")
def register_user(user: RegisterRequest, response: Response):
    logger.info("========================================")
    logger.info(f"===> [РЕГИСТРАЦИЯ] Первичные данные получены для: {user.email}")
    logger.info("========================================")

    response.status_code = status.HTTP_201_CREATED
    return {
        "code": 201,
        "state": "Created",
        "message": "Verification code sent to email"
    }

@app.post("/api/auth/send_code")
def send_code(payload: SendCodeRequest, response: Response):
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
    
    if payload.code != "123456":
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"code": 400, "state": "Bad Request", "message": "Invalid code"}
        
    response.status_code = status.HTTP_200_OK
    extracted_username = payload.email.split('@')[0]
    
    return {
        "code": 200,
        "state": "OK",
        "access_token": f"jwt.token.for.{extracted_username}.success",
        "reset_token": f"temporary-token-for-password-reset-via-{payload.email}"
    }

@app.patch("/api/db/me/preferences")
def update_user_preferences(payload: PreferencesRequest, response: Response):
    logger.info("========================================")
    logger.info("===> [БЭКЕНД ФИЛТР] Настройки пользователя обновлены!")
    logger.info(f"Запрещенное (forbidden): {payload.forbidden}")
    logger.info(f"Религии (religions): {payload.religions}")
    logger.info(f"Оборудование (kitchen_equipment): {payload.kitchen_equipment}")
    logger.info("========================================")

    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

@app.get("/api/db/me/preferences")
def get_user_preferences(response: Response):
    logger.info("===> [БЭКЕНД ФИЛЬТР] Запрос GET /api/db/me/preferences успешно обработан!")
    
    response.status_code = status.HTTP_200_OK
    return {
        "forbidden": ["nuts", "fish"],
        "religions": ["halal", "vegan"],
        "kitchen_equipment": ["microwave", "toaster", "stove"]
    }

@app.get("/api/db/me")
def get_my_profile(response: Response):
    global SAVED_AVATAR_DATA, SAVED_USERNAME_DATA
    logger.info("===> [БЭКЕНД] Запрос GET /api/db/me")
    
    response.status_code = status.HTTP_200_OK
    return {
        "user_id": 123,
        "username": SAVED_USERNAME_DATA,
        "avatar_url": SAVED_AVATAR_DATA,
        "email": "valeria@example.com",
        "birth_date": "15.06.1995",
        "gender": "Ж",
        "height": 180,
        "weight": 75,
        "code": 200,
        "state": "OK"
    }

@app.patch("/api/db/me")
def update_my_profile(payload: UpdateProfileRequest, response: Response):
    global SAVED_AVATAR_DATA, SAVED_USERNAME_DATA
    logger.info("===> [БЭКЕНД] Профиль и аватарка успешно обновлены!")
    
    SAVED_USERNAME_DATA = payload.username
    if payload.avatar_url:
        SAVED_AVATAR_DATA = payload.avatar_url
    
    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

@app.post("/api/auth/new_pswd")
def change_password(data: NewPasswordRequest, response: Response):
    logger.info("========================================")
    logger.info(f"===> [БЭКЕНД] Запрос на смену пароля успешно получен.")
    logger.info("========================================")
    
    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

@app.get("/api/db/recipes/next")
def get_next_recipe(response: Response):
    global NEXT_RECIPE_POINTER
    
    if NEXT_RECIPE_POINTER > len(MOCK_RECIPES):
        logger.info("===> [РЕЦЕПТЫ] Все тестовые карточки выданы, возвращаем пустой массив.")
        response.status_code = status.HTTP_200_OK
        return {"recipes": []}
        
    current_id = NEXT_RECIPE_POINTER
    NEXT_RECIPE_POINTER += 1
    logger.info(f"===> [РЕЦЕПТЫ] Выдан следующий ID в очередь: {current_id}")
    
    response.status_code = status.HTTP_200_OK
    return {
        "recipe_id": current_id,
        "code": 200,
        "state": "OK"
    }

@app.get("/api/db/recipes/{recipe_id}")
def get_recipe_details(recipe_id: int, response: Response):
    recipe = MOCK_RECIPES.get(recipe_id)
    if not recipe:
        response.status_code = status.HTTP_404_NOT_FOUND
        return {"code": 404, "state": "Not Found"}
        
    logger.info(f"===> [РЕЦЕПТЫ] Загружены детали рецепта #{recipe_id}: {recipe['title']}")
    response.status_code = status.HTTP_200_OK
    return {
        **recipe,
        "code": 200,
        "state": "OK"
    }

@app.put("/api/db/recipes/reaction")
def react_to_recipe(payload: RecipeReactionRequest, response: Response):
    logger.info("========================================")
    logger.info(f"===> [РЕАКЦИЯ] Рецепт #{payload.recipe_id} -> действие: {payload.action}")
    logger.info("========================================")

    if payload.recipe_id == 5:
        response.status_code = status.HTTP_404_NOT_FOUND
        return {"code": 404, "state": "Not Found"}

    if payload.recipe_id == 6:
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"code": 401, "state": "Unauthorized"}

    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

app.mount(
    "/",
    StaticFiles(directory=str(BASE_DIR), html=True),
    name="frontend",
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)