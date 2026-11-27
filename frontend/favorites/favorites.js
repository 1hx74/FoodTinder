/* =========================================================
   СКРИПТ СТРАНИЦЫ «ИЗБРАННОЕ» (FOODTINDER)
   - Загрузка пачками по 5 штук с дозагрузкой при прокрутке
   ========================================================= */

const BATCH_SIZE = 5;

let allFavoriteIds = null;
let loadedCount = 0;
let isLoadingBatch = false;
let hasMore = true;

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

function formatIngredientMeasure(rawQuantity, rawCount) {
    const key = String(rawQuantity || "").trim().toLowerCase();
    const unit = UNIT_DICTIONARY[key] || rawQuantity || "";
    const count = Number(rawCount);

    if (Number.isNaN(count) || count <= 0) {
        return unit;
    }
    if (unit === "гр" && count >= 1000) {
        return `${Number((count / 1000).toFixed(2))} кг`;
    }
    if (unit === "мл" && count >= 1000) {
        return `${Number((count / 1000).toFixed(2))} л`;
    }

    return `${count} ${unit}`.trim();
}

function getUserEquipment() {
    try {
        const cached = localStorage.getItem("global_cache_equipment");
        if (cached) {
            const parsed = JSON.parse(cached);
            return Array.isArray(parsed?.kitchen_equipment) ? parsed.kitchen_equipment : [];
        }
    } catch (e) {
        console.error("[favorites.js] Ошибка чтения кеша оборудования:", e);
    }
    return [];
}

async function ensureUserEquipmentLoaded() {
    try {
        const cached = localStorage.getItem("global_cache_equipment");
        if (cached) {
            const parsed = JSON.parse(cached);
            return Array.isArray(parsed?.kitchen_equipment) ? parsed.kitchen_equipment : [];
        }
        if (window.AuthAPI && typeof window.AuthAPI.getCachedEquipment === "function") {
            const prefs = await window.AuthAPI.getCachedEquipment();
            return Array.isArray(prefs?.kitchen_equipment) ? prefs.kitchen_equipment : [];
        }
    } catch (e) {
        console.error("[favorites.js] Ошибка загрузки настроек пользователя:", e);
    }
    return getUserEquipment();
}

async function loadHyperTextContent(hyperTextValue, containerEl) {
    if (!containerEl) return;

    const value = String(hyperTextValue || "").trim();
    if (
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.endsWith(".html") ||
        value.endsWith(".htm")
    ) {
        containerEl.innerHTML = "Загрузка рецепта...";
        try {
            const response = await fetch(value);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            containerEl.innerHTML = await response.text();
        } catch (err) {
            console.error("[favorites.js] Ошибка загрузки инструкции по ссылке:", err);
            containerEl.innerText = "Не удалось загрузить инструкции по приготовлению.";
        }
    } else {
        containerEl.innerText = value || "Инструкция приготовления отсутствует.";
    }
}

/* Удаление рецепта из избранного */
async function handleRemoveFavorite(recipeId, cardEl, removeBtn) {
    if (!recipeId || !cardEl) return;

    if (removeBtn) {
        removeBtn.disabled = true;
    }

    try {
        await window.AuthAPI.removeFromFavorites(recipeId);
    } catch (error) {
        if (error.status === 401) {
            alert("Вы не авторизованы. Пожалуйста, войдите в аккаунт!");
            window.location.href = "/login/";
            return;
        }
        if (error.status !== 404) {
            console.error("[favorites.js] Ошибка удаления из избранного:", error);
            alert("Не удалось удалить рецепт из избранного. Попробуйте ещё раз.");
            if (removeBtn) removeBtn.disabled = false;
            return;
        }
    }

    // Удаляем ID из локального списка allFavoriteIds, чтобы пагинация оставалась точной
    if (Array.isArray(allFavoriteIds)) {
        const idx = allFavoriteIds.findIndex((item) => {
            const id = typeof item === "object" && item !== null ? item.recipe_id : item;
            return String(id) === String(recipeId);
        });
        if (idx !== -1) {
            allFavoriteIds.splice(idx, 1);
            if (idx < loadedCount) {
                loadedCount = Math.max(0, loadedCount - 1);
            }
        }
    }

    // Плавное исчезновение карточки из DOM
    cardEl.classList.add("removing");
    setTimeout(() => {
        cardEl.remove();

        const listEl = document.getElementById("favorites-list");
        const emptyEl = document.getElementById("empty-state");

        if (listEl && listEl.children.length === 0 && !hasMore && emptyEl) {
            emptyEl.style.display = "flex";
        } else {
            checkAndLoadMore();
        }
    }, 240);
}

/* Создание DOM-элемента одной карточки */
function createRecipeCard(recipe, userEquipment = []) {
    const card = document.createElement("article");
    card.className = "frame-16";
    if (recipe.recipe_id !== undefined && recipe.recipe_id !== null) {
        card.dataset.recipeId = String(recipe.recipe_id);
    }

    // Серый крестик в правом верхнем углу карточки
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-favorite-btn";
    removeBtn.title = "Удалить из избранного";
    removeBtn.setAttribute("aria-label", "Удалить из избранного");
    removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleRemoveFavorite(recipe.recipe_id, card, removeBtn);
    });
    card.appendChild(removeBtn);

    const titleText = recipe.title || "Без названия";
    const fallbackPlaceholder = `https://placehold.co/600x400?text=${encodeURIComponent(titleText)}`;
    const imageUrl = recipe.image_url || fallbackPlaceholder;

    // 1. Картинка блюда
    const img = document.createElement("img");
    img.className = "rectangle-14";
    img.src = imageUrl;
    img.alt = titleText;
    img.loading = "lazy";
    img.onerror = () => {
        img.onerror = null;
        img.src = fallbackPlaceholder;
    };

    // 2. Внутренний контейнер
    const inner = document.createElement("div");
    inner.className = "recipe-inner-content";

    // Название и описание
    const textBlock = document.createElement("div");
    textBlock.className = "div7";

    const titleEl = document.createElement("div");
    titleEl.className = "recipe-title";
    titleEl.innerText = titleText;

    const descEl = document.createElement("div");
    descEl.className = "recipe-desc";
    descEl.innerText = recipe.description || "";

    textBlock.append(titleEl, descEl);

    // 3. Блок метаданных (Сложность + звёзды, Калории, Время и вес, КБЖУ)
    const metaCol = document.createElement("div");
    metaCol.className = "recipe-meta-column";

    // Строка 1: Сложность и каллории
    const row1 = document.createElement("div");
    row1.className = "recipe-meta-row";

    const diffBox = document.createElement("div");
    diffBox.className = "difficulty-box";

    const diffLabel = document.createElement("span");
    diffLabel.className = "meta-label";
    diffLabel.innerText = "Сложность:";

    const starsRow = document.createElement("div");
    starsRow.className = "stars-row";
    const starsCount = Math.max(0, Math.min(5, Number(recipe.stars) || 0));
    for (let i = 0; i < starsCount; i++) {
        const starSpan = document.createElement("span");
        starSpan.className = "star-icon";
        starSpan.innerHTML = `<svg width="18" height="18" viewBox="0 0 22 20" fill="#FFB800" xmlns="http://www.w3.org/2000/svg"><path d="M11 0L13.4697 7.60081H21.4616L14.996 12.2984L17.4656 19.8992L11 15.2016L4.53436 19.8992L7.00402 12.2984L0.538379 7.60081H8.53035L11 0Z"/></svg>`;
        starsRow.appendChild(starSpan);
    }
    diffBox.append(diffLabel, starsRow);

    const calBox = document.createElement("div");
    calBox.className = "calories-box";
    calBox.innerText = recipe.kalories ? `${recipe.kalories} ккал` : "";

    row1.append(diffBox, calBox);

    // Строка 2: время и вес
    const row2 = document.createElement("div");
    row2.className = "recipe-meta-row info-row";
    row2.innerHTML = `
        <span>⏱ ${recipe.cooking_time || 0} мин</span>
        <span>⚖ ${recipe.final_weight || 0} г</span>
    `;

    // Строка 3: Белки / Жиры / Углеводы
    const row3 = document.createElement("div");
    row3.className = "recipe-meta-row macros-row";
    row3.innerHTML = `
        <span>Белки: ${recipe.belki || 0} г</span>
        <span>Жиры: ${recipe.fats || 0} г</span>
        <span>Углеводы: ${recipe.uglevods || 0} г</span>
    `;

    metaCol.append(row1, row2, row3);

    // 4. Блок «Оборудование:»
    let equipmentSection = null;
    if (Array.isArray(recipe.equipment) && recipe.equipment.length > 0) {
        equipmentSection = document.createElement("div");
        equipmentSection.className = "equipment-section";

        const eqLabel = document.createElement("div");
        eqLabel.className = "meta-label";
        eqLabel.innerText = "Оборудование:";

        const eqWrap = document.createElement("div");
        eqWrap.className = "equipment-container";

        recipe.equipment.forEach((rawKey) => {
            const key = String(rawKey || "").trim();
            if (!key) return;
            const pill = document.createElement("div");
            const isAvailable = userEquipment.includes(key);
            pill.className = `equipment-pill ${isAvailable ? "available" : "unavailable"}`;
            pill.innerText = EQUIPMENT_TRANSLATIONS[key] || key;
            eqWrap.appendChild(pill);
        });

        equipmentSection.append(eqLabel, eqWrap);
    }

    // 5. Раскрывающаяся секция (Ингредиенты и Способ приготовления)
    const expandable = document.createElement("div");
    expandable.className = "expandable-section";

    // Ингредиенты
    const ingSection = document.createElement("div");
    ingSection.className = "ingredients-section";

    const ingLabel = document.createElement("div");
    ingLabel.className = "meta-label";
    ingLabel.innerText = "Ингредиенты:";

    const ingList = document.createElement("ul");
    ingList.className = "ingredients-list";

    if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
        recipe.ingredients.forEach((item) => {
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

            li.append(nameSpan, dotsSpan, amountSpan);
            ingList.appendChild(li);
        });
    } else {
        ingList.innerHTML = `<li class="ingredient-item">Список продуктов не указан</li>`;
    }
    ingSection.append(ingLabel, ingList);

    // Способ приготовления
    const stepsSection = document.createElement("div");
    stepsSection.className = "recipe-steps-section";

    const stepsLabel = document.createElement("div");
    stepsLabel.className = "meta-label";
    stepsLabel.innerText = "Способ приготовления:";

    const stepsText = document.createElement("div");
    stepsText.className = "recipe-steps-text";
    stepsSection.append(stepsLabel, stepsText);

    expandable.append(ingSection, stepsSection);

    // 6. Кнопка «Посмотреть рецепт» / «Назад»
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "div5";
    toggleBtn.style.width = "100%";
    toggleBtn.innerHTML = `<span class="div6">Посмотреть рецепт</span>`;

    let stepsLoaded = false;
    toggleBtn.addEventListener("click", async () => {
        const isExpanded = card.classList.toggle("expanded");
        const btnLabel = toggleBtn.querySelector(".div6");

        if (btnLabel) {
            btnLabel.innerText = isExpanded ? "Назад" : "Посмотреть рецепт";
        }

        if (isExpanded) {
            // Прокручиваем к началу карточки
            const yOffset = -80;
            const y = card.getBoundingClientRect().top +
                        window.pageYOffset +
                        yOffset;

            window.scrollTo({
                    top: y,
                    behavior: "smooth"
    });
            if (!stepsLoaded) {
                stepsLoaded = true;
                const rawHyperText = recipe["hyper-text"] || recipe.hyper_text;
                await loadHyperTextContent(rawHyperText, stepsText);
            }
        } else {
            // Возвращаем пользователя к карточке,
            // из которой он открыл полный рецепт.
            const yOffset = -80;
            const y = card.getBoundingClientRect().top +
                     window.pageYOffset +
                     yOffset;

            window.scrollTo({
                top: y,
                behavior: "smooth"
            });
        }
    });

    inner.append(textBlock, metaCol);
    if (equipmentSection) {
        inner.appendChild(equipmentSection);
    }
    inner.append(expandable, toggleBtn);

    card.append(img, inner);
    return card;
}

/* Загрузка следующей пачки из 5 рецептов */
async function loadNextBatch() {
    if (isLoadingBatch || !hasMore) return;
    isLoadingBatch = true;

    const listEl = document.getElementById("favorites-list");
    const sentinelEl = document.getElementById("loading-sentinel");
    const emptyEl = document.getElementById("empty-state");

    if (sentinelEl) {
        sentinelEl.style.display = "block";
    }

    try {
        const userEquipment = await ensureUserEquipmentLoaded();

        if (allFavoriteIds === null) {
            const response = await window.AuthAPI.getFavorites();
            const rawList = Array.isArray(response)
                ? response
                : (response?.recipes || response?.favorites || response?.recipe_ids || []);

            allFavoriteIds = rawList;
        }

        if (allFavoriteIds.length === 0) {
            hasMore = false;
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }

        const slice = allFavoriteIds.slice(loadedCount, loadedCount + BATCH_SIZE);
        loadedCount += slice.length;

        if (loadedCount >= allFavoriteIds.length) {
            hasMore = false;
        }

        const fullRecipes = await Promise.all(
            slice.map(async (item) => {
                if (typeof item === "object" && item !== null && item.title) {
                    return item;
                }
                const id = typeof item === "object" && item !== null ? item.recipe_id : item;
                if (!id) return null;

                try {
                    return await window.AuthAPI.getRecipeById(id);
                } catch (err) {
                    console.warn(`[favorites.js] Рецепт ${id} не найден или недоступен:`, err);
                    return null;
                }
            })
        );

        fullRecipes.filter(Boolean).forEach((recipe) => {
            if (listEl) {
                listEl.appendChild(createRecipeCard(recipe, userEquipment));
            }
        });

        if (listEl && listEl.children.length === 0 && !hasMore && emptyEl) {
            emptyEl.style.display = "flex";
        }
    } catch (error) {
        if (error.status === 401) {
            alert("Вы не авторизованы. Пожалуйста, войдите в аккаунт!");
            window.location.href = "/login/";
        } else if (error.status === 500 || error.status === 0) {
            alert("Технические шоколадки, уже чиним! Попробуйте обновить страницу чуть позже.");
        } else {
            console.error("[favorites.js] Ошибка загрузки избранного:", error);
        }
    } finally {
        isLoadingBatch = false;
        if (sentinelEl) {
            sentinelEl.style.display = hasMore ? "block" : "none";
        }
    }
}

/* Проверка, пора ли подгрузить следующую пачку из 5 рецептов */
function checkAndLoadMore() {
    if (!hasMore || isLoadingBatch) return;

    const sentinelEl = document.getElementById("loading-sentinel");
    if (!sentinelEl) return;

    const rect = sentinelEl.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 300) {
        loadNextBatch().then(() => {
            if (hasMore) {
                setTimeout(checkAndLoadMore, 100);
            }
        });
    }
}

/* Инициализация страницы и подгрузки по 5 карточек при прокрутке */
document.addEventListener("DOMContentLoaded", async () => {
    if (!window.AuthAPI || !window.AuthAPI.isAuthenticated()) {
        alert("Раздел «Избранное» доступен только авторизованным пользователям.");
        window.location.href = "/login/";
        return;
    }

    await loadNextBatch();
    checkAndLoadMore();

    window.addEventListener("scroll", checkAndLoadMore, { passive: true });
    window.addEventListener("resize", checkAndLoadMore, { passive: true });
});
