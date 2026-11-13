/**
 * ФАЙЛ: swipe.js
 * ДЛЯ ЧЕГО: Управляет очередью рецептов в sessionStorage (лимит 5 шт.),
 * первичным показом, фоновой догрузкой и отправкой реакций (like, dislike, favorite)
 * с учётом активной сессии и точечной обработкой ошибок 401, 404 и 500.
 */

const QUEUE_STORAGE_KEY = "recipeQueue";
const MAX_QUEUE_SIZE = 5;

let currentRecipe = null;
let isFetchingQueue = false;
let noMoreRecipes = false;

// --- РАБОТА С ОЧЕРЕДЬЮ В SESSIONSTORAGE (живёт только пока активна сессия вкладки) ---
function getQueue() {
    try {
        return JSON.parse(sessionStorage.getItem(QUEUE_STORAGE_KEY)) || [];
    } catch (_) {
        return [];
    }
}

function saveQueue(queue) {
    sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

// --- ОТРИСОВКА КАРТОЧКИ НА ЭКРАНЕ ---
function renderRecipe(recipe) {
    const cardEl = document.getElementById("recipe-card");
    const emptyEl = document.getElementById("empty-state");
    const controlsEl = document.getElementById("reaction-controls");

    if (!recipe) {
        cardEl.style.display = "none";
        controlsEl.style.display = "none";
        emptyEl.style.display = "flex";
        return;
    }

    currentRecipe = recipe;
    cardEl.style.display = "flex";
    controlsEl.style.display = "flex";
    emptyEl.style.display = "none";

    // Подставляем фото, заголовок, описание и ссылку
    const imgEl = document.getElementById("recipe-image");
    imgEl.src = recipe.image_url || "rectangle-140.png";

    document.getElementById("recipe-title").innerText = recipe.title || "Без названия";
    document.getElementById("recipe-description").innerText = recipe.description || "";

    const linkBtn = document.getElementById("recipe-link-btn");
    linkBtn.href = recipe["hyper-text"] || "#";

    // Подставляем калорийность из обновлённого ключа calories_and_macros
    const caloriesEl = document.getElementById("recipe-calories");
    if (caloriesEl) {
        caloriesEl.innerText = recipe.calories_and_macros ? `${recipe.calories_and_macros} ккал` : "";
    }

    // Отрисовываем звёзды по полю stars
    const starsContainer = document.getElementById("recipe-stars");
    const starsCount = Math.max(0, Math.min(5, Number(recipe.stars) || 0));
    starsContainer.innerHTML = "";
    for (let i = 0; i < starsCount; i++) {
        const starImg = document.createElement("img");
        starImg.className = "star-icon";
        starImg.src = "star-10.svg";
        starImg.alt = "★";
        starsContainer.appendChild(starImg);
    }

    // Сбрасываем анимацию улёта
    cardEl.classList.remove("swipe-left", "swipe-right");
}

// --- ЗАГРУЗКА ОДНОГО РЕЦЕПТА С БЭКЕНДА ---
async function fetchSingleRecipe() {
    const nextRes = await window.AuthAPI.getNextRecipeId();

    // Сценарий: Рецепты закончились ({ "recipes": [] } или пустой ответ)
    if (Array.isArray(nextRes?.recipes) && nextRes.recipes.length === 0) {
        noMoreRecipes = true;
        return null;
    }
    if (!nextRes || !nextRes.recipe_id) {
        noMoreRecipes = true;
        return null;
    }

    // Запрашиваем полные данные карточки по ID
    const fullRecipe = await window.AuthAPI.getRecipeById(nextRes.recipe_id);
    return fullRecipe;
}

// --- ФОНОВОЕ ПОПОЛНЕНИЕ ОЧЕРЕДИ ДО 5 КАРТОЧЕК ---
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
                // Защита от бесконечного цикла, если сервер по кругу отдаёт один и тот же ID
                break;
            }
        }
    } catch (error) {
        handleLoadError(error);
    } finally {
        isFetchingQueue = false;
    }
}

// --- ОБРАБОТКА ОШИБОК ПРИ ЗАГРУЗКЕ КАРТОЧЕК ---
function handleLoadError(error) {
    if (error.status === 500 || error.status === 0) {
        alert("Технические шоколадки, уже чиним! Попробуйте обновить страницу чуть позже.");
    } else if (error.status === 401) {
        alert("Вы не авторизованы. Пожалуйста, войдите в аккаунт!");
        window.location.href = "../vxod/index.html";
    } else if (error.status === 404) {
        noMoreRecipes = true;
        if (!currentRecipe && getQueue().length === 0) {
            renderRecipe(null);
        }
    } else {
        console.error("[swipe.js] Ошибка загрузки рецепта:", error);
    }
}

// --- ПЕРЕХОД К СЛЕДУЮЩЕЙ КАРТОЧКЕ ИЗ ОЧЕРЕДИ ---
async function showNextFromQueue() {
    const queue = getQueue();

    if (queue.length > 0) {
        const nextCard = queue.shift();
        saveQueue(queue);
        renderRecipe(nextCard);
        // Сразу пополняем очередь в фоне обратно до 5 карточек
        fillQueueInBackground();
    } else if (!noMoreRecipes) {
        try {
            const freshCard = await fetchSingleRecipe();
            renderRecipe(freshCard);
            fillQueueInBackground();
        } catch (err) {
            handleLoadError(err);
        }
    } else {
        currentRecipe = null;
        renderRecipe(null);
    }
}

// --- РЕАКЦИЯ ПОЛЬЗОВАТЕЛЯ: LIKE / DISLIKE / FAVORITE ---
async function handleReaction(action) {
    if (!currentRecipe) return;

    // ДОБАВЛЕНО: Защита от отправки favorite при отсутствии активной сессии
    if (action === "favorite" && !window.AuthAPI.isAuthenticated()) {
        const goLogin = confirm("Добавление в избранное доступно только авторизованным пользователям. Перейти на страницу входа?");
        if (goLogin) {
            window.location.href = "../vxod/index.html";
        }
        return;
    }

    const reactedRecipeId = currentRecipe.recipe_id;
    const cardEl = document.getElementById("recipe-card");

    // 1. Отправляем реакцию на бэкенд (токен автоматически подставится внутри api.js)
    try {
        await window.AuthAPI.sendRecipeReaction(reactedRecipeId, action);
    } catch (error) {
        // Ошибка 401: пользователь не авторизован -> окно + предложение войти
        if (error.status === 401) {
            const goLogin = confirm("Вы не авторизованы! Хотите перейти на страницу входа?");
            if (goLogin) {
                window.location.href = "../vxod/index.html";
            }
            return;
        }

        // Ошибка 404: рецепт удалён на бэке
        if (error.status === 404) {
            if (action === "favorite") {
                // Для избранного обязательно предупреждаем пользователя
                alert("Этот рецепт больше недоступен.");
            }
            // Для like / dislike — игнорируем ошибку, чтобы пользователь не заметил сбоя,
            // и просто пролистываем карточку дальше
        } else if (error.status === 500 || error.status === 0) {
            alert("Технические шоколадки, уже чиним!");
            return;
        }
    }

    // 2. Анимация свайпа и переход к следующей карточке из очереди
    cardEl.classList.add(action === "dislike" ? "swipe-left" : "swipe-right");

    setTimeout(() => {
        showNextFromQueue();
    }, 220);
}

// --- ПОДДЕРЖКА СВАЙПОВ ПАЛЬЦЕМ / МЫШЬЮ ПО КАРТОЧКЕ ---
function initTouchSwipe() {
    const cardEl = document.getElementById("recipe-card");
    if (!cardEl) return;

    let startX = 0;

    cardEl.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
    }, { passive: true });

    cardEl.addEventListener("touchend", (e) => {
        const endX = e.changedTouches[0].clientX;
        const diffX = endX - startX;

        if (Math.abs(diffX) > 60) {
            handleReaction(diffX > 0 ? "like" : "dislike");
        }
    });
}

// --- ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ ---
document.addEventListener("DOMContentLoaded", async () => {
    const favBtn = document.getElementById("btn-favorite");
    const isAuth = window.AuthAPI && window.AuthAPI.isAuthenticated();

    // ДОБАВЛЕНО: Блокируем кнопку "Избранное", если у пользователя нет активной сессии (токена)
    if (favBtn) {
        if (!isAuth) {
            favBtn.disabled = true;
            favBtn.style.opacity = "0.4";
            favBtn.style.cursor = "not-allowed";
            favBtn.style.pointerEvents = "none";
            favBtn.title = "Войдите в аккаунт, чтобы добавлять в избранное";
        } else {
            favBtn.disabled = false;
            favBtn.style.opacity = "1";
            favBtn.style.cursor = "pointer";
            favBtn.style.pointerEvents = "auto";
            favBtn.addEventListener("click", () => handleReaction("favorite"));
        }
    }

    document.getElementById("btn-dislike")?.addEventListener("click", () => handleReaction("dislike"));
    document.getElementById("btn-like")?.addEventListener("click", () => handleReaction("like"));

    initTouchSwipe();

    // Первичная загрузка: если в очереди текущей сессии уже есть карточки — берём оттуда
    const queue = getQueue();
    if (queue.length > 0) {
        const firstCard = queue.shift();
        saveQueue(queue);
        renderRecipe(firstCard);
        fillQueueInBackground();
    } else {
        try {
            // Сразу грузим первую карточку пользователю на показ
            const firstRecipe = await fetchSingleRecipe();
            renderRecipe(firstRecipe);
            // После показа первой карточки в фоне догружаем очередь до 5 штук
            fillQueueInBackground();
        } catch (error) {
            handleLoadError(error);
        }
    }
});
