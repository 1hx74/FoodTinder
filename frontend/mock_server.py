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
        "recipe_id": 1,
        "image_url": "rectangle-140.png",
        "title": "Паста Карбонара с хрустящим беконом",
        "description": "Классический итальянский рецепт с нежным сливочно-яичным соусом и пармезаном. Готовится всего за 20 минут!",
        "stars": 5,
        "kitchen_equipment": ["stove", "pot"],
        "products": ["pasta", "bacon", "eggs", "parmesan"],
        "calories_and_macros": 640,
        "hyper-text": "https://example.com",
    },
    2: {
        "recipe_id": 2,
        "image_url": "rectangle-140.png",
        "title": "Том Ям с креветками и кокосовым молоком",
        "description": "Пряный тайский суп с яркой кислинкой лайма, лемонграссом и тигровыми креветками.",
        "stars": 4,
        "kitchen_equipment": ["stove", "pot"],
        "products": ["shrimp", "coconut_milk", "lime", "mushrooms"],
        "calories_and_macros": 420,
        "hyper-text": "https://example.com",
    },
    3: {
        "recipe_id": 3,
        "image_url": "rectangle-140.png",
        "title": "Сырники из фермерского творога с ягодами",
        "description": "Пышные золотистые сырники с ванилью, подаются со сметаной и свежей голубикой.",
        "stars": 5,
        "kitchen_equipment": ["stove", "frying_pan"],
        "products": ["cottage_cheese", "eggs", "flour", "berries"],
        "calories_and_macros": 380,
        "hyper-text": "https://example.com",
    },
    4: {
        "recipe_id": 4,
        "image_url": "rectangle-140.png",
        "title": "Запечённый лосось со спаржей и лимоном",
        "description": "Сочное филе красной рыбы в духовке с ароматными травами и хрустящей зелёной спаржей.",
        "stars": 4,
        "kitchen_equipment": ["oven", "backing_dish"],
        "products": ["salmon", "asparagus", "lemon", "olive_oil"],
        "calories_and_macros": 510,
        "hyper-text": "https://example.com",
    },
    5: {
        "recipe_id": 5,
        "image_url": "rectangle-140.png",
        "title": "[ТЕСТ ОШИБКИ 404] Удалённый рецепт рамена",
        "description": "Нажми 'Избранное' — увидишь предупреждение. Нажми 'Лайк/Дизлайк' — ошибка проигнорируется!",
        "stars": 3,
        "kitchen_equipment": ["stove"],
        "products": ["noodles", "egg"],
        "calories_and_macros": 490,
        "hyper-text": "https://example.com",
    },
    6: {
        "recipe_id": 6,
        "image_url": "rectangle-140.png",
        "title": "[ТЕСТ ОШИБКИ 401] Секретный стейк Рибай",
        "description": "При любой реакции на эту карточку сервер вернёт 401 Unauthorized и предложит войти в аккаунт.",
        "stars": 5,
        "kitchen_equipment": ["stove", "frying_pan"],
        "products": ["beef", "rosemary", "butter"],
        "calories_and_macros": 780,
        "hyper-text": "https://example.com",
    },
}

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

# Контракт строго разделен на 4 независимые категории полей
class PreferencesRequest(BaseModel):
    """Контракт валидации для сохранения настроек профиля"""
    allergies: list[str] = []
    diets: list[str] = []
    religions: list[str] = []
    kitchen_equipment: list[str] = []

NEXT_RECIPE_POINTER = 1
class RecipeReactionRequest(BaseModel):
    """Контракт реакции на карточку рецепта (like / dislike / favorite)"""
    recipe_id: int
    action: str

@app.get("/swipe")
def swipe_page():
    """Перенаправляет на страницу свайпа рецептов"""
    return RedirectResponse(url="/swipe/")


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

# --- ЭНДПОИНТЫ ЛИЧНОГО КАБИНЕТА ПОЛЬЗОВАТЕЛЯ ---

@app.get("/api/db/me")
def get_my_profile(response: Response):
    """Возвращает данные текущего профиля с учетом сохраненной аватарки"""
    global SAVED_AVATAR_DATA, SAVED_USERNAME_DATA
    logger.info("===> [БЭКЕНД] Запрос GET /api/db/me")
    
    response.status_code = status.HTTP_200_OK
    return {
        "user_id": 123,
        "username": SAVED_USERNAME_DATA,
        "avatar_url": SAVED_AVATAR_DATA,  # Возвращаем сохраненную картинку (или None)
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
    """Обновляет параметры пользователя и аватарку на сервере"""
    global SAVED_AVATAR_DATA, SAVED_USERNAME_DATA
    logger.info("===> [БЭКЕНД] Профиль и аватарка успешно обновлены!")
    
    # Сохраняем измененные фронтендом данные в память сервера
    SAVED_USERNAME_DATA = payload.username
    if payload.avatar_url:
        SAVED_AVATAR_DATA = payload.avatar_url
        logger.info("===> [БЭКЕНД] Новая аватарка успешно бинаризирована и сохранена в кэш сервера.")
    
    response.status_code = status.HTTP_200_OK
    return {
        "code": 200,
        "state": "OK"
    }

@app.post("/api/auth/new_pswd")
def change_password(data: NewPasswordRequest, response: Response):
    """Принимает запрос на установку нового пароля по токену сброса"""
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
    """Выдаёт ID следующего рецепта для пополнения очереди на фронтенде"""
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
    """Возвращает полную карточку рецепта по его ID"""
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
    """Принимает реакцию (like / dislike / favorite) и симулирует ошибки 404 и 401"""
    logger.info("========================================")
    logger.info(f"===> [РЕАКЦИЯ] Рецепт #{payload.recipe_id} -> действие: {payload.action}")
    logger.info("========================================")

    # Симуляция ошибки 404 (рецепт удалили на сервере)
    if payload.recipe_id == 5:
        response.status_code = status.HTTP_404_NOT_FOUND
        return {"code": 404, "state": "Not Found"}

    # Симуляция ошибки 401 (пользователь не авторизован)
    if payload.recipe_id == 6:
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"code": 401, "state": "Unauthorized"}

    response.status_code = status.HTTP_200_OK
    return {
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
    # Запускаем локальный uvicorn-воркер на стандартном loopback-интерфейсе 127.0.0.1
    uvicorn.run(app, host="127.0.0.1", port=8000)
