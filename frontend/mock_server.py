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
from datetime import date
from pathlib import Path
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


# Подключаемся напрямую к логгеру запущенного воркера Uvicorn,
# чтобы системные обработчики не перехватывали наши сообщения.
logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# Профили пользователей в памяти сервера: {ключ из токена: профиль}. Пусто при старте,
# профиль создаётся при регистрации
app.state.profiles = {}

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
    password: str # Изменено: при регистрации передаем только email и пароль

class LoginRequest(BaseModel):
    """Контракт для входа в систему (принимает логин или почту)"""
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
    
    # Автоматически создаем логин из Email (например, test@mail.ru -> test)
    generated_username = user.email.split('@')[0]
    logger.info(f"===> [РЕГИСТРАЦИЯ] Сгенерирован логин: {generated_username}")
    logger.info("========================================")

    # Создаем профиль нового пользователя. Ключ — начало почты до @ (как в токене из verify_code).
    # Данных, которые пользователь еще не вводил, нет: он заполнит их на странице профиля.
    app.state.profiles.setdefault(user.email.split("@")[0], {
        "user_id": len(app.state.profiles) + 1,
        "username": user.username,
        "avatar_url": "",
        "email": user.email,
        "birth_date": "",
        "gender": "",
        "height": None,
        "weight": None,
    })

    # Выставляем статус 201 Created — данные успешно кэшированы, ждем код подтверждения
    response.status_code = status.HTTP_201_CREATED
    return {
        "code": 201,
        "state": "Created",
        "username": generated_username,
        "message": "Verification code sent to email"
    }

# ДОБАВЛЕННЫЙ ЭНДПОИНТ ДЛЯ ВХОДА (ПОДДЕРЖИВАЕТ И ЛОГИН, И EMAIL)
@app.post("/api/auth/login")
def login_user(user: LoginRequest, response: Response):
    """
    Принимает логин (или email) и пароль. Возвращает токен сессии.
    """
    logger.info("========================================")
    logger.info(f"===> [ВХОД] Получены данные: {user.username}")
    
    # Умная обработка: если есть @, значит это Email. Берем часть до @ как логин.
    if "@" in user.username:
        display_username = user.username.split("@")[0]
    else:
        display_username = user.username 
        
    # ПРОВЕРКА: Есть ли такой пользователь в нашей мок-базе?
    if display_username not in app.state.profiles:
        logger.info(f"===> [ВХОД] Ошибка: Пользователь {display_username} не найден.")
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {
            "code": 401, 
            "state": "Unauthorized",
            "message": "Пользователь с таким логином не найден"
        }

    logger.info(f"===> [ВХОД] Успех для пользователя {display_username}")
    response.status_code = status.HTTP_200_OK
    return {
        "user_id": app.state.profiles[display_username]["user_id"],
        "username": display_username,
        "access_token": f"jwt.token.for.{display_username}.success",
        "code": 200,
        "state": "OK"
    }


# --- 8. ЭНДПОИНТЫ ДВУХФАКТОРНОГО ПОДТВЕРЖДЕНИЯ И ВОССТАНОВЛЕНИЯ ---

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

#Профили пользователей в app.state.profiles (создаётся при старте).
# Заготовленного пользователя нет: профиль появляется при регистрации и дальше
def current_user_key(request: Request) -> str | None:
    """Достаёт ключ пользователя из заголовка 'Authorization: Bearer jwt.token.for.<имя>.success'."""
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not (token.startswith("jwt.token.for.") and token.endswith(".success")):
        return None
    return token.removeprefix("jwt.token.for.").removesuffix(".success")


def error_response(status_code: int, state: str, message: str) -> JSONResponse:
    """Ошибка по контракту: code + state. Поле message — подсказка для отладки (api.js выводит её в alert)."""
    return JSONResponse(
        status_code=status_code,
        content={"code": status_code, "state": state, "message": message},
    )

# --- ЭНДПОИНТЫ ЛИЧНОГО КАБИНЕТА ПОЛЬЗОВАТЕЛЯ ---

@app.get("/api/db/me")
def get_my_profile(request: Request):
    """Возвращает актуальный профиль пользователя, чей токен прислан (контракт: GET /api/db/me)."""
    key = current_user_key(request)
    if key is None:
        logger.info("===> [БЭКЕНД ПРОФИЛЬ] GET /api/db/me отклонён: нет токена (401)")
        return error_response(401, "Unauthorized", "Not authorized")

    profile = app.state.profiles.get(key)
    if profile is None:
        logger.info(f"===> [БЭКЕНД ПРОФИЛЬ] GET /api/db/me: пользователь '{key}' не найден (404)")
        return error_response(404, "Not Found", "User not found")

    logger.info("========================================")
    logger.info(f"===> [БЭКЕНД ПРОФИЛЬ] Запрос GET /api/db/me для '{key}' успешно обработан!")
    logger.info(f"Текущие данные в памяти: { {k: v for k, v in profile.items() if k != 'avatar_url'} }")
    logger.info(f"Аватар (avatar_url): {'задан, ' + str(len(profile['avatar_url'])) + ' символов' if profile['avatar_url'] else 'не задан'}")
    logger.info("========================================")

    return {**profile, "code": 200, "state": "OK"}


@app.patch("/api/db/me")
def update_my_profile(payload: UpdateProfileRequest, request: Request):
    """
    Принимает поля профиля, проверяет их и перезаписывает профиль этого пользователя,
    чтобы следующий GET вернул уже новые данные (обратная подгрузка).
    """
    key = current_user_key(request)
    if key is None:
        logger.info("===> [БЭКЕНД ПРОФИЛЬ] PATCH /api/db/me отклонён: нет токена (401)")
        return error_response(401, "Unauthorized", "Not authorized")

    logger.info("========================================")
    logger.info(f"===> [БЭКЕНД ПРОФИЛЬ] Получен PATCH /api/db/me от '{key}'")
    logger.info(f"Имя (username): {payload.username}")
    logger.info(f"Дата рождения (birth_date): {payload.birth_date}")
    logger.info(f"Пол (gender): {payload.gender}")
    logger.info(f"Рост (height): {payload.height}")
    logger.info(f"Вес (weight): {payload.weight}")
    logger.info("Аватар (avatar_url): "
                + (f"прислан, {len(payload.avatar_url)} символов" if payload.avatar_url else "не менялся"))
    logger.info("========================================")

    profile = app.state.profiles.get(key)
    if profile is None:
        return error_response(404, "Not Found", "User not found")

    # Остальные ошибочные случаи по контракту — тоже 404 (текст — в message для отладки)
    username = payload.username.strip()
    if not username:
        return error_response(404, "Not Found", "Имя не может быть пустым")
    if payload.gender not in ("men", "women"):
        return error_response(404, "Not Found", "Некорректное значение пола")
    if not 50 <= payload.height <= 250:
        return error_response(404, "Not Found", "Рост должен быть от 50 до 250 см")
    if not 20 <= payload.weight <= 300:
        return error_response(404, "Not Found", "Вес должен быть от 20 до 300 кг")
    try:
        birth = date.fromisoformat(payload.birth_date)
    except ValueError:
        return error_response(404, "Not Found", "Дата рождения должна быть в формате ГГГГ-ММ-ДД")
    if birth > date.today():
        return error_response(404, "Not Found", "Дата рождения не может быть в будущем")
    if payload.avatar_url is not None and not payload.avatar_url.startswith(("data:image/", "http")):
        return error_response(404, "Not Found", "avatar_url должен быть ссылкой или data:image/...")

    profile["username"] = username
    profile["birth_date"] = payload.birth_date
    profile["gender"] = payload.gender
    profile["height"] = payload.height
    profile["weight"] = payload.weight
    # avatar_url в запросе необязателен: не прислали — аватар остаётся прежним
    if payload.avatar_url is not None:
        profile["avatar_url"] = payload.avatar_url

    return {"code": 200, "state": "OK"}

@app.post("/api/auth/new_pswd")
def change_password(data: NewPasswordRequest, response: Response):
    logger.info("========================================")
    logger.info(f"===> [БЭКЕНД] Запрос на смену пароля успешно получен.")
    logger.info("========================================")

    if len(data.new_password) < 6:
        response.status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
        return {"code": 422, "state": "Unprocessable Entity"}
    
    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }


# --- ЭНДПОИНТ ДЛЯ СТРАНИЦЫ ДОСТИЖЕНИЙ ---

@app.get("/api/db/achievements")
def get_achievements(response: Response):
    logger.info("===> [БЭКЕНД] Запрос на получение достижений")
    
    response.status_code = status.HTTP_200_OK
    return {
        "achievements": [
            {
                "id": 1, 
                "title": "РЕГИСТРАЦИЯ", 
                "description": "Успешно зарегистрироваться на сайте", 
                "icon_url": "https://placehold.co/100x100?text=Reg", 
                "is_unlocked": True
            },
            {
                "id": 2, 
                "title": "ПЕРВЫЙ ЛАЙК", 
                "description": "Поставить лайк первому рецепту", 
                "icon_url": "https://placehold.co/100x100?text=Like", 
                "is_unlocked": False
            },
            {
                "id": 3, 
                "title": "ПЕРВЫЙ ДИЗЛАЙК", 
                "description": "Поставить дизлайк первому рецепту", 
                "icon_url": "https://placehold.co/100x100?text=Dislike", 
                "is_unlocked": False
            },
            {
                "id": 4, 
                "title": "ПЕРВОЕ ИЗБРАННОЕ", 
                "description": "Добавить первый рецепт в избранное", 
                "icon_url": "https://placehold.co/100x100?text=Fav", 
                "is_unlocked": False
            },
            {
                "id": 5, 
                "title": "100 ЛАЙКОВ", 
                "description": "Поставить лайк 100 рецептам", 
                "icon_url": "https://placehold.co/100x100?text=100Like", 
                "is_unlocked": False
            },
            {
                "id": 6, 
                "title": "100 ДИЗЛАЙКОВ", 
                "description": "Поставить дизлайк 100 рецептам", 
                "icon_url": "https://placehold.co/100x100?text=100Dis", 
                "is_unlocked": False
            },
            {
                "id": 7, 
                "title": "100 В ИЗБРАННОМ", 
                "description": "Добавить 100 рецептов в избранное", 
                "icon_url": "https://placehold.co/100x100?text=100Fav", 
                "is_unlocked": False
            }
        ],
        "code": 200,
        "state": "OK"
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
    uvicorn.run(app, host="127.0.0.1", port=8000)