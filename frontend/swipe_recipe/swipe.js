/**
 * ФАЙЛ: swipe.js
 * ДЛЯ ЧЕГО: Управляет очередью рецептов, отображением параметров, динамической загрузкой
 * изображений из ответа сервера и реакциями с учетом глобального кеша.
 */

const QUEUE_STORAGE_KEY = "recipeQueue";
const MAX_QUEUE_SIZE = 5;

let currentRecipe = null;
let isFetchingQueue = false;
let noMoreRecipes = false;

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

// Получение оборудования через глобальный кеш в api.js
async function getUserPreferences() {
    return await window.AuthAPI.getCachedEquipment();
}

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

async function renderRecipe(recipe) {
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

    // Динамическая подстановка ссылки на картинку из тела ответа сервера
    const imageEl = document.getElementById("recipe-image");
    const titleText = recipe.title || "Без названия";
    const fallbackPlaceholder = `https://placehold.co/600x400?text=${encodeURIComponent(titleText)}`;
    const imageUrl = recipe.image_url || recipe.image || fallbackPlaceholder;

    imageEl.onerror = () => {
        imageEl.onerror = null;
        imageEl.src = fallbackPlaceholder;
    };
    imageEl.src = imageUrl;
    imageEl.alt = titleText;

    document.getElementById("recipe-title").innerText = titleText;
    document.getElementById("recipe-description").innerText = recipe.description || "";

    const linkBtn = document.getElementById("recipe-link-btn");
    if (linkBtn) {
        linkBtn.style.display = "flex";
        linkBtn.href = recipe["hyper-text"] || "#";
    }

    document.getElementById("recipe-calories").innerText = recipe.kalories ? `${recipe.kalories} ккал` : "";
    document.getElementById("recipe-time").innerText = recipe.cooking_time || "0";
    document.getElementById("recipe-weight").innerText = recipe.final_weight || "0";
    document.getElementById("recipe-belki").innerText = recipe.belki || "0";
    document.getElementById("recipe-fats").innerText = recipe.fats || "0";
    document.getElementById("recipe-uglevods").innerText = recipe.uglevods || "0";

    const starsContainer = document.getElementById("recipe-stars");
    const starsCount = Math.max(0, Math.min(5, Number(recipe.difficulty) || 0));
    starsContainer.innerHTML = "";
    for (let i = 0; i < starsCount; i++) {
        const starImg = document.createElement("img");
        starImg.className = "star-icon";
        starImg.src = "star-10.svg";
        starImg.alt = "★";
        starsContainer.appendChild(starImg);
    }

    const equipmentContainer = document.getElementById("recipe-equipment");
    equipmentContainer.innerHTML = "";
    
    if (Array.isArray(recipe.equipment) && recipe.equipment.length > 0) {
        const prefs = await getUserPreferences();
        const userEquipment = prefs.kitchen_equipment || [];

        recipe.equipment.forEach(itemKey => {
            const pill = document.createElement("div");
            const isAvailable = userEquipment.includes(itemKey);
            
            pill.className = `equipment-pill ${isAvailable ? "available" : "unavailable"}`;
            pill.innerText = EQUIPMENT_TRANSLATIONS[itemKey] || itemKey;
            equipmentContainer.appendChild(pill);
        });
    }

    cardEl.classList.remove("swipe-left", "swipe-right");
}

async function fetchSingleRecipe() {
    const nextRes = await window.AuthAPI.getNextRecipeId();

    if (Array.isArray(nextRes?.recipes) && nextRes.recipes.length === 0) {
        noMoreRecipes = true;
        return null;
    }
    if (!nextRes || !nextRes.recipe_id) {
        noMoreRecipes = true;
        return null;
    }

    return await window.AuthAPI.getRecipeById(nextRes.recipe_id);
}

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

async function handleReaction(action) {
    if (!currentRecipe) return;

    // Избранное строго требует авторизации
    if (action === "favorite" && !window.AuthAPI.isAuthenticated()) {
        const goLogin = confirm("Добавление в избранное доступно только авторизованным пользователям. Перейти на страницу входа?");
        if (goLogin) {
            window.location.href = "../vxod/index.html";
        }
        return;
    }

    const reactedRecipeId = currentRecipe.recipe_id;
    const cardEl = document.getElementById("recipe-card");

    try {
        await window.AuthAPI.sendRecipeReaction(reactedRecipeId, action);
    } catch (error) {
        if (error.status === 401) {
            if (confirm("Вы не авторизованы! Хотите перейти на страницу входа?")) {
                window.location.href = "../vxod/index.html";
            }
            return;
        }
        if (error.status === 404 && action === "favorite") {
            alert("Этот рецепт больше недоступен.");
        } else if (error.status === 500 || error.status === 0) {
            alert("Технические шоколадки, уже чиним!");
            return;
        }
    }

    cardEl.classList.add(action === "dislike" ? "swipe-left" : "swipe-right");
    setTimeout(() => {
        showNextFromQueue();
    }, 220);
}

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

    // Загрузка оборудования через глобальный кеш
    await getUserPreferences();

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