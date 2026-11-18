/*
- НАЗНАЧЕНИЕ СКРИПТА
 *
- Скрипт отвечает за работу ленты рецептов FOODTINDER:
- - получение рецептов с backend;
- - предварительную загрузку следующих карточек;
- - хранение временной очереди рецептов;
- - отображение информации о рецепте;
- - обработку лайков, дизлайков и добавления в избранное;
- - обработку свайпов и нажатий на кнопки;
- - отображение заглушки при окончании рецептов.
 *
- ОСОБЕННОСТИ ОБЩЕЙ ЛОГИКИ
- 1. Рецепты загружаются заранее, чтобы уменьшить ожидание
-    при переключении карточек.
- 2. Очередь хранится в sessionStorage и не требует
-    повторной загрузки уже полученных рецептов в рамках
-    текущей сессии вкладки.
- 3. Размер очереди ограничен MAX_QUEUE_SIZE.
- 4. Если конкретный рецепт больше недоступен (404 при
-    запросе полного рецепта), скрипт пропускает его
-    и запрашивает следующий.
- 5. Конец ленты определяется только после подтверждения
-    со стороны /recipes/next.
- 6. Заглушка «Вы просмотрели все карточки!» показывается
-    только тогда, когда рецепты закончились и очередь пуста.
 *
 *
- QUEUE_STORAGE_KEY — ключ sessionStorage, под которым хранится
- очередь предварительно загруженных рецептов.
 *
- SELECTED_RECIPE_KEY — ключ для хранения выбранного рецепта.
- В текущей версии скрипта не используется.
 *
- MAX_QUEUE_SIZE — максимальное количество рецептов
- в очереди предварительной загрузки (5).
 *
- currentRecipe — объект рецепта, который сейчас отображается
- пользователю.
 *
- isFetchingQueue — флаг, предотвращающий одновременный запуск
- нескольких процессов заполнения очереди.
 *
- noMoreRecipes — флаг, указывающий, что backend подтвердил
- окончание выдачи рецептов.

*/
const QUEUE_STORAGE_KEY = "recipeQueue";
const SELECTED_RECIPE_KEY = "selectedRecipe";
const MAX_QUEUE_SIZE = 5;

let currentRecipe = null;
let isFetchingQueue = false;
let noMoreRecipes = false;
let isReacting = false;

const EQUIPMENT_TRANSLATIONS = {
    oven: "Духовка",
    stove: "Плита",
    microwave: "Микроволновка",
    multicooker: "Мультиварка",
    air_fryer: "Аэрогриль",
    toaster: "Тостер",
    waffle_maker: "Вафельница",
    mixer: "Миксер",
    blender: "Блендер",
    meat_grinder: "Мясорубка",
    backing_dish: "Форма для запекания",
    backind_sheet: "Противень",
    grater: "Терка",
    wisk: "Венчик",
    rolling_scale: "Скалка",
    pot: "Кастрюля"
};

const UNIT_DICTIONARY = {
    "g": "гр",
    "gr": "гр",
    "gram": "гр",
    "gramm": "гр",
    "гр": "гр",
    "ml": "мл",
    "milliliter": "мл",
    "milliliters": "мл",
    "мл": "мл",
    "it": "шт",
    "item": "шт",
    "items": "шт",
    "шт": "шт",
    "kg": "кг",
    "kilogram": "кг",
    "кг": "кг",
    "l": "л",
    "liter": "л",
    "liters": "л",
    "л": "л",
    "tsp": "ч. л.",
    "tbsp": "ст. л.",
    "cup": "ст."
};


/* 1. formatIngredientMeasure(rawQuantity, rawCount)
 *
- Форматирует количество и единицу измерения ингредиента.
- Переводит единицы измерения в сокращённый русский формат
- (например, g → гр, ml → мл).
 *
- Дополнительно переводит граммы в килограммы, а миллилитры
- в литры, если количество достигает 1000.
 */

function formatIngredientMeasure(rawQuantity, rawCount) {
    const key = String(rawQuantity || "").trim().toLowerCase();
    const unit = UNIT_DICTIONARY[key] || rawQuantity || "";
    const count = Number(rawCount);

    if (Number.isNaN(count) || count <= 0) {
        return unit;
    }

    if (unit === "гр" && count >= 1000) {
        const kg = Number((count / 1000).toFixed(2));
        return `${kg} кг`;
    }
    if (unit === "мл" && count >= 1000) {
        const liters = Number((count / 1000).toFixed(2));
        return `${liters} л`;
    }

    return `${count} ${unit}`.trim();
}

/* 2. getUserPreferences()
 *
- Всегда берет данные об оборудовании напрямую из localStorage (кеша),
- исключая любые сетевые запросы на бэкенд.
 */
function getUserPreferences() {
    try {
        const cached = localStorage.getItem("global_cache_equipment");
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (e) {
        console.error("[swipe.js] Ошибка чтения кеша оборудования:", e);
    }
    return { kitchen_equipment: [], allergies: [], diets: [], religions: [] };
}

/* 3. getQueue()
 *
- Получает очередь рецептов из sessionStorage.
- Если данные отсутствуют или не удалось разобрать JSON,
- возвращает пустой массив.
 *
- Очередь сохраняется только в рамках текущей вкладки
- и сессии браузера.
 */
function getQueue() {
    try {
        return JSON.parse(sessionStorage.getItem(QUEUE_STORAGE_KEY)) || [];
    } catch (_) {
        return [];
    }
}

/* 4. saveQueue(queue)
 *
- Сохраняет переданную очередь рецептов в sessionStorage.
- Используется при добавлении и извлечении карточек из очереди.
 */
function saveQueue(queue) {
    sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

/* 5. loadHyperTextContent(hyperTextValue, containerEl) - мб будет изменена
 *
- Загружает и отображает инструкцию по приготовлению.
 *
- Поддерживает два варианта данных:
- - обычный текст — выводится непосредственно в контейнер;
- - ссылка на HTML-файл — загружает содержимое через fetch().
 *
- Если загрузить внешний файл не удалось, отображает сообщение
- об ошибке.
 */
async function loadHyperTextContent(hyperTextValue, containerEl) {
    if (!containerEl) return;
    
    const value = String(hyperTextValue || "").trim();
    
    // Проверяем, является ли значение ссылкой (начинается с http или содержит расширение .html/.htm)
    if (value.startsWith("http://") || value.startsWith("https://") || value.endsWith(".html") || value.endsWith(".htm")) {
        containerEl.innerHTML = "Загрузка рецепта...";
        try {
            const response = await fetch(value);
            if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
            
            const htmlContent = await response.text();
            // Вставляем полученный код/разметку внутрь блока
            containerEl.innerHTML = htmlContent;
        } catch (error) {
            console.error("[swipe.js] Не удалось загрузить контент по ссылке:", error);
            containerEl.innerText = "Не удалось загрузить инструкции по приготовлению.";
        }
    } else {
        // Если это обычный текст, выводим как текст
        containerEl.innerText = value || "Инструкция приготовления отсутствует.";
    }
}

/*
- 6. renderRecipe(recipe)
 *
- Отвечает за отображение карточки рецепта на странице.
 *
- Заполняет:
- - название и описание;
- - изображение;
- - калорийность и время приготовления;
- - вес и пищевую ценность;
- - рейтинг в виде звёзд;
- - необходимое кухонное оборудование;
- - список ингредиентов;
- - инструкцию по приготовлению.
 *
- Также проверяет наличие оборудования у пользователя
- и визуально отмечает доступные и отсутствующие предметы.
 *
- Если вместо рецепта передан null, скрывает карточку
- и кнопки реакций, показывая заглушку empty-state.
 */
async function renderRecipe(recipe) {
    const cardEl = document.getElementById("recipe-card");
    const emptyEl = document.getElementById("empty-state");
    const controlsEl = document.getElementById("reaction-controls");

    if (!recipe) {
        currentRecipe = null;
        if (cardEl) cardEl.style.display = "none";
        if (controlsEl) controlsEl.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
    }

    currentRecipe = recipe;
    if (cardEl) cardEl.style.display = "flex";
    if (controlsEl) controlsEl.style.display = "flex";
    if (emptyEl) emptyEl.style.display = "none";

    const imageEl = document.getElementById("recipe-image");
    const titleText = recipe.title || "Без названия";
    const fallbackPlaceholder = `https://placehold.co/${encodeURIComponent(titleText)}`;
    const imageUrl = recipe.image_url || fallbackPlaceholder;

    if (imageEl) {
        imageEl.onerror = () => {
            imageEl.onerror = null;
            imageEl.src = fallbackPlaceholder;
        };
        imageEl.src = imageUrl;
        imageEl.alt = titleText;
    }

    const titleEl = document.getElementById("recipe-title");
    if (titleEl) titleEl.innerText = titleText;

    const descEl = document.getElementById("recipe-description");
    if (descEl) descEl.innerText = recipe.description || "";

    const caloriesEl = document.getElementById("recipe-calories");
    if (caloriesEl) caloriesEl.innerText = recipe.kalories ? `${recipe.kalories} ккал` : "";

    const timeEl = document.getElementById("recipe-time");
    if (timeEl) timeEl.innerText = recipe.cooking_time || "0";

    const weightEl = document.getElementById("recipe-weight");
    if (weightEl) weightEl.innerText = recipe.final_weight || "0";

    const belkiEl = document.getElementById("recipe-belki");
    if (belkiEl) belkiEl.innerText = recipe.belki || "0";

    const fatsEl = document.getElementById("recipe-fats");
    if (fatsEl) fatsEl.innerText = recipe.fats || "0";

    const uglevodsEl = document.getElementById("recipe-uglevods");
    if (uglevodsEl) uglevodsEl.innerText = recipe.uglevods || "0";

    const starsContainer = document.getElementById("recipe-stars");
    if (starsContainer) {
        const starsCount = Math.max(0, Math.min(5, Number(recipe.stars) || 0));
        starsContainer.innerHTML = "";
        for (let i = 0; i < starsCount; i++) {
            const starImg = document.createElement("img");
            starImg.className = "star-icon";
            starImg.src = "star-10.svg";
            starImg.alt = "★";
            starsContainer.appendChild(starImg);
        }
    }

    const equipmentContainer = document.getElementById("recipe-equipment");
    if (equipmentContainer) {
        equipmentContainer.innerHTML = "";
        if (Array.isArray(recipe.equipment) && recipe.equipment.length > 0) {
            const prefs = getUserPreferences();
            const userEquipment = prefs.kitchen_equipment || [];

            recipe.equipment.forEach(itemKey => {
                const pill = document.createElement("div");
                const isAvailable = userEquipment.includes(itemKey);

                pill.className = `equipment-pill ${isAvailable ? "available" : "unavailable"}`;
                pill.innerText = EQUIPMENT_TRANSLATIONS[itemKey] || itemKey;
                equipmentContainer.appendChild(pill);
            });
        }
    }

    const ingredientsContainer = document.getElementById("recipe-ingredients");
    if (ingredientsContainer) {
        ingredientsContainer.innerHTML = "";
        if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
            recipe.ingredients.forEach(item => {
                const li = document.createElement("li");
                li.className = "ingredient-item";

                const nameSpan = document.createElement("span");
                nameSpan.className = "ingredient-name";
                nameSpan.innerText = item.name || "";

                const dotsSpan = document.createElement("span");
                dotsSpan.className = "ingredient-dots";

                const amountSpan = document.createElement("span");
                amountSpan.className = "ingredient-amount";
                amountSpan.innerText = formatIngredientMeasure(item.quantity, item.count);

                li.appendChild(nameSpan);
                li.appendChild(dotsSpan);
                li.appendChild(amountSpan);
                ingredientsContainer.appendChild(li);
            });
        } else {
            ingredientsContainer.innerHTML = `<li class="ingredient-item">Список продуктов не указан</li>`;
        }
    }

    // Загрузка способа приготовления (поддерживает как текст, так и ссылку на внешний файл)
    const stepsContainer = document.getElementById("recipe-hyper-text");
    if (stepsContainer) {
        const rawHyperText = recipe["hyper-text"] || recipe.hyper_text;
        await loadHyperTextContent(rawHyperText, stepsContainer);
    }

    if (cardEl) {
        cardEl.classList.remove("swipe-left", "swipe-right");

        cardEl.style.transition = "";
        cardEl.style.transform = "";
        cardEl.style.opacity = "";
    }
}

/* 7. fetchSingleRecipe()
 *
- Получает и возвращает следующий полный рецепт.
 *
- Последовательность работы:
- 1. Отправляет запрос на /api/db/recipes/next.
- 2. Получает recipe_id следующего рецепта.
- 3. Запрашивает полный рецепт через /api/db/recipes/{id}.
- 4. Возвращает полученный объект рецепта.
 *
- ОСОБЕННОСТЬ ОБРАБОТКИ 404:
- - 404 от /recipes/next означает окончание ленты.
-   Устанавливает noMoreRecipes = true.
- - 404 от /recipes/{id} означает, что конкретный рецепт
-   недоступен. Такой рецепт пропускается, после чего функция
-   повторно запрашивает следующий ID через /recipes/next.
 *
- Таким образом, удаление отдельного рецепта не приводит
- к преждевременному завершению ленты.
 */
async function fetchSingleRecipe() {
    while (!noMoreRecipes) {
        let nextRes;

        // Получаем следующий ID рецепта
        try {
            nextRes = await window.AuthAPI.getNextRecipeId();
        } catch (error) {
            error.recipeEndpoint = "next";

            // Только 404 от /recipes/next означает конец ленты
            if (error.status === 404) {
                noMoreRecipes = true;
                return null;
            }

            throw error;
        }

        // Поддержка ответа с пустым массивом рецептов
        if (Array.isArray(nextRes?.recipes) && nextRes.recipes.length === 0) {
            noMoreRecipes = true;
            return null;
        }

        // Проверяем наличие ID
        if (!nextRes || !nextRes.recipe_id) {
            const error = new Error("Бэкенд не вернул recipe_id");
            error.recipeEndpoint = "next";
            throw error;
        }

        // Получаем полный рецепт по ID
        try {
            return await window.AuthAPI.getRecipeById(nextRes.recipe_id);
        } catch (error) {
            // 404 конкретного рецепта — пропускаем его
            if (error.status === 404) {
                console.warn(
                    `[swipe.js] Рецепт ${nextRes.recipe_id} недоступен. Запрашиваем следующий.`
                );

                continue;
            }

            // Остальные ошибки передаём обработчику
            error.recipeEndpoint = "recipe";
            throw error;
        }
    }

    return null;
}

/* 8. fillQueueInBackground()
 *
- Фоновое заполнение очереди рецептами.
 *
- Пока в очереди меньше MAX_QUEUE_SIZE рецептов,
- функция вызывает fetchSingleRecipe() и добавляет
- полученные рецепты в sessionStorage.
 *
- Проверяет дубликаты относительно текущего рецепта
- и уже загруженной очереди.
 *
- Не допускает одновременного запуска нескольких процессов
- загрузки благодаря флагу isFetchingQueue.
 *
- Если backend подтвердил окончание ленты, заполнение
- очереди прекращается.
 */
async function fillQueueInBackground() {
    if (isFetchingQueue || noMoreRecipes) return;
    isFetchingQueue = true;

    try {
        while (getQueue().length < MAX_QUEUE_SIZE && !noMoreRecipes) {
            const recipe = await fetchSingleRecipe();
            if (!recipe) break;

            const queue = getQueue();
            const isDuplicate =
                queue.some(item => item.recipe_id === recipe.recipe_id) ||
                currentRecipe?.recipe_id === recipe.recipe_id;

            if (!isDuplicate) {
                queue.push(recipe);
                saveQueue(queue);
            } else {
                break;
            }
        }
    } catch (error) {
        handleLoadError(error);
    } finally {
        isFetchingQueue = false;
    }
}

/* 9. handleLoadError(error)
 *
- Централизованная обработка ошибок при загрузке рецептов.
 *
- Обрабатывает основные HTTP-статусы:
- - 500 и 0 — техническая ошибка, показывает уведомление;
- - 401 — предлагает авторизоваться и перенаправляет
-   пользователя на страницу входа;
- - 404 — завершает выдачу только в случае, если ошибка
-   относится к endpoint /recipes/next.
 *
- 404 отдельного рецепта обрабатывается непосредственно
- в fetchSingleRecipe() и не завершает ленту.
 */
function handleLoadError(error) {
    if (error.status === 500 || error.status === 0) {
        alert("Технические шоколадки, уже чиним! Попробуйте обновить страницу чуть позже.");

    } else if (error.status === 401) {
        alert("Вы не авторизованы. Пожалуйста, войдите в аккаунт!");
        window.location.href = "../vxod/index.html";

    } else if (error.status === 404) {
        // Конец ленты подтверждается только ответом
        // 404 от /recipes/next
        if (error.recipeEndpoint === "next") {
            noMoreRecipes = true;

            if (!currentRecipe && getQueue().length === 0) {
                renderRecipe(null);
            }
        }

        // 404 от /recipes/{id} здесь не завершает ленту:
        // такой рецепт уже пропускается в fetchSingleRecipe()

    } else {
        console.error("[swipe.js] Ошибка загрузки рецепта:", error);
    }
}

/* 10. showNextFromQueue()
 *
- Переключает пользователя на следующую карточку.
 *
- Порядок работы:
- 1. Если очередь не пуста — извлекает первый рецепт
-    и отображает его.
- 2. После отображения запускает фоновое пополнение очереди.
- 3. Если очередь пуста, но рецепты ещё могут быть,
-    запрашивает следующий рецепт напрямую.
- 4. Если очередь пуста и backend подтвердил окончание ленты,
-    отображает empty-state.
 */
async function showNextFromQueue() {
    const queue = getQueue();

    if (queue.length > 0) {
        const nextCard = queue.shift();
        saveQueue(queue);
        await renderRecipe(nextCard);
        fillQueueInBackground();
    } else if (!noMoreRecipes) {
        try {
            const freshCard = await fetchSingleRecipe();
            await renderRecipe(freshCard);
            fillQueueInBackground();
        } catch (err) {
            handleLoadError(err);
        }
    } else {
        currentRecipe = null;
        renderRecipe(null);
    }
}

/* 11. handleReaction(action)
 *
- Обрабатывает реакцию пользователя на текущий рецепт.
 *
- Поддерживаемые действия:
- - like — лайк;
- - dislike — дизлайк;
- - favorite — добавление в избранное.
 *
- Передаёт реакцию в AuthAPI.sendRecipeReaction().
- Для добавления в избранное требуется авторизация.
 *
- После успешной обработки реакции запускает анимацию
- карточки и через небольшую задержку переключает
- пользователя на следующий рецепт.
 */
async function handleReaction(action) {
    if (!currentRecipe || isReacting) return;

    if (
        action === "favorite" &&
        (!window.AuthAPI || !window.AuthAPI.isAuthenticated())
    ) {
        const goLogin = confirm(
            "Добавление в избранное доступно только авторизованным пользователям. Перейти на страницу входа?"
        );

        if (goLogin) {
            window.location.href = "../vxod/index.html";
        }

        return;
    }

    isReacting = true;

    const reactedRecipeId = currentRecipe.recipe_id;
    const cardEl = document.getElementById("recipe-card");

    try {
        await window.AuthAPI.sendRecipeReaction(reactedRecipeId, action);
    } catch (error) {
        if (error.status === 401) {
            if (confirm("Вы не авторизованы! Хотите перейти на страницу входа?")) {
                window.location.href = "../vxod/index.html";
            }

            isReacting = false;
            return;
        }

        if (error.status === 404 && action === "favorite") {
            alert("Этот рецепт больше недоступен.");
        } else if (error.status === 500 || error.status === 0) {
            alert("Технические шоколадки, уже чиним!");
            isReacting = false;
            return;
        }
    }

    if (!cardEl) {
        isReacting = false;
        await showNextFromQueue();
        return;
    }

    const direction = action === "dislike" ? -1 : 1;
    const distance = window.innerWidth + cardEl.offsetWidth;

    cardEl.style.transition = "transform 0.35s ease, opacity 0.35s ease";
    cardEl.style.transform =
        `translate3d(${direction * distance}px, 0, 0) rotate(${direction * 15}deg)`;
    cardEl.style.opacity = "0";

    let finished = false;

    const finishAnimation = async () => {
        if (finished) return;
        finished = true;

        cardEl.removeEventListener("transitionend", onTransitionEnd);

        await showNextFromQueue();
        isReacting = false;
    };

    const onTransitionEnd = (event) => {
        if (event.target === cardEl && event.propertyName === "transform") {
            finishAnimation();
        }
    };

    cardEl.addEventListener("transitionend", onTransitionEnd);

    // Запасной вариант, если transitionend не сработает
    setTimeout(finishAnimation, 500);
}

/* 12. initTouchSwipe()
 *
- Подключает обработку свайпов на карточке рецепта.
 *
- Определяет горизонтальное перемещение пальца:
- - движение вправо более чем на 60 пикселей — like;
- - движение влево более чем на 60 пикселей — dislike.
 *
- Для обработки используется touchstart и touchend.
 */

function initTouchSwipe() {
    const cardEl = document.getElementById("recipe-card");
    if (!cardEl) return;

    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let activePointerId = null;

    cardEl.style.touchAction = "pan-y";

    function resetCardInstantly() {
        cardEl.style.transition = "none";
        cardEl.style.transform = "";
        cardEl.style.opacity = "";

        void cardEl.offsetWidth;

        cardEl.style.transition = "";
    }

    cardEl.addEventListener("pointerdown", (event) => {
        // Не запускаем свайп, если рецепт развернут (есть класс .expanded)
        if (cardEl.classList.contains("expanded")) {
            return;
        }

        // Не запускаем свайп при нажатии на кнопки и другие элементы управления
        if (event.target.closest(
            "button, a, input, textarea, select, #toggle-recipe-btn"
        )) {
            return;
        }

        if (isReacting || !currentRecipe) return;
        if (event.button !== 0) return;

        startX = event.clientX;
        currentX = startX;
        isDragging = true;
        activePointerId = event.pointerId;

        cardEl.style.transition = "none";
        cardEl.setPointerCapture(event.pointerId);
    });

    cardEl.addEventListener("pointermove", (event) => {
        if (!isDragging || event.pointerId !== activePointerId) return;
        if (isReacting || cardEl.classList.contains("expanded")) return;

        currentX = event.clientX;

        const diffX = currentX - startX;
        const rotation = diffX * 0.04;

        cardEl.style.transform =
            `translate3d(${diffX}px, 0, 0) rotate(${rotation}deg)`;
    });

    cardEl.addEventListener("pointerup", (event) => {
        if (!isDragging || event.pointerId !== activePointerId) return;

        const diffX = event.clientX - startX;

        isDragging = false;
        activePointerId = null;

        const swipeThreshold = Math.max(90, cardEl.offsetWidth * 0.22);

        if (Math.abs(diffX) >= swipeThreshold) {
            handleReaction(diffX > 0 ? "like" : "dislike");
        } else {
            resetCardInstantly();
        }
    });

    cardEl.addEventListener("pointercancel", (event) => {
        if (!isDragging || event.pointerId !== activePointerId) return;

        isDragging = false;
        activePointerId = null;

        resetCardInstantly();
    });
}


/* 13. Обработчик DOMContentLoaded (инициализация ленты)
 *
- Выполняется после загрузки HTML-документа.
 *
- Выполняет первоначальную настройку:
- - определяет статус авторизации;
- - настраивает кнопку избранного;
- - подключает обработчики кнопок like и dislike;
- - инициализирует свайпы;
- - загружает настройки пользователя (из кеша);
- - отображает первую карточку из очереди или запрашивает
-   первый рецепт с backend;
- - запускает фоновое заполнение очереди.
 */
document.addEventListener("DOMContentLoaded", async () => {
    const favBtn = document.getElementById("btn-favorite");
    const isAuth = window.AuthAPI && window.AuthAPI.isAuthenticated();

    if (favBtn) {
        if (!isAuth) {
            favBtn.disabled = true;
            favBtn.style.opacity = "0.4";
            favBtn.style.cursor = "not-allowed";
            favBtn.title = "Войдите в аккаунт, чтобы добавлять в избранное";
        } else {
            favBtn.disabled = false;
            favBtn.addEventListener("click", () => handleReaction("favorite"));
        }
    }

    document.getElementById("btn-dislike")?.addEventListener("click", () => handleReaction("dislike"));
    document.getElementById("btn-like")?.addEventListener("click", () => handleReaction("like"));

    initTouchSwipe();
    getUserPreferences();

    const queue = getQueue();
    if (queue.length > 0) {
        const firstCard = queue.shift();
        saveQueue(queue);
        await renderRecipe(firstCard);
        fillQueueInBackground();
    } else {
        try {
            const firstRecipe = await fetchSingleRecipe();
            await renderRecipe(firstRecipe);
            fillQueueInBackground();
        } catch (error) {
            handleLoadError(error);
        }
    }
});

/* 14. Обработчик DOMContentLoaded (раскрытие карточки)
 *
- Подключает кнопку раскрытия рецепта.
 *
- При нажатии переключает класс expanded у карточки
- и меняет текст кнопки:
- - «Посмотреть рецепт»;
- - «Назад».
 *
- При сворачивании карточки прокручивает страницу
- к началу.
 */
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-recipe-btn");
    const btnText = document.getElementById("toggle-btn-text");
    const cardEl = document.getElementById("recipe-card");

    if (!cardEl) return;

    if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
            e.preventDefault();

            const isExpanded = cardEl.classList.toggle("expanded");

            if (btnText) {
                btnText.innerText = isExpanded
                    ? "Назад"
                    : "Посмотреть рецепт";
            }

            if (!isExpanded) {
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            }
        });
    }
});