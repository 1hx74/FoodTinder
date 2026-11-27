/**
 * Общая отрисовка полной карточки рецепта (как в свайпах после «Посмотреть рецепт»).
 * Используется и лентой свайпов, и планировщиком.
 */
(function (global) {
    "use strict";

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

    function field(root, id) {
        if (!root) return null;
        return root.querySelector("#" + id);
    }

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

    async function loadHyperTextContent(hyperTextValue, containerEl) {
        if (!containerEl) return;

        const value = String(hyperTextValue || "").trim();

        if (value.startsWith("http://") || value.startsWith("https://") || value.endsWith(".html") || value.endsWith(".htm")) {
            containerEl.innerHTML = "Загрузка рецепта...";
            try {
                const response = await fetch(value);
                if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
                const htmlContent = await response.text();
                containerEl.innerHTML = htmlContent;
            } catch (error) {
                console.error("[recipe-card] Не удалось загрузить контент по ссылке:", error);
                containerEl.innerText = "Не удалось загрузить инструкции по приготовлению.";
            }
        } else {
            containerEl.innerText = value || "Инструкция приготовления отсутствует.";
        }
    }

    async function loadUserPreferences() {
        try {
            const cached = localStorage.getItem("global_cache_equipment");
            if (cached) {
                return JSON.parse(cached);
            }
            if (global.AuthAPI && typeof global.AuthAPI.getCachedEquipment === "function") {
                return await global.AuthAPI.getCachedEquipment();
            }
        } catch (e) {
            console.error("[recipe-card] Ошибка загрузки настроек пользователя:", e);
        }
        return { kitchen_equipment: [], allergies: [], diets: [], religions: [] };
    }

    async function fill(root, recipe, options) {
        const opts = options || {};
        const starSrc = opts.starSrc || "/swipe/star.svg";
        const loadHyperText = Boolean(opts.loadHyperText);
        const hyperTextPlaceholder = opts.hyperTextPlaceholder
            || "Нажмите «Посмотреть рецепт», чтобы загрузить инструкцию.";
        const isStale = typeof opts.isStale === "function" ? opts.isStale : () => false;

        if (!root || !recipe) return;
        if (isStale()) return;

        const titleText = recipe.title || "Без названия";
        const fallbackPlaceholder = `https://placehold.co/${encodeURIComponent(titleText)}`;
        const imageUrl = recipe.image_url || fallbackPlaceholder;

        const imageEl = field(root, "recipe-image");
        if (imageEl) {
            imageEl.onload = null;
            imageEl.onerror = null;
            if (opts.skipImage) {
                imageEl.removeAttribute("src");
                imageEl.alt = titleText;
                imageEl.style.display = "none";
            } else {
                imageEl.style.display = "";
                imageEl.onerror = () => {
                    imageEl.onerror = null;
                    imageEl.src = fallbackPlaceholder;
                };
                imageEl.src = imageUrl;
                imageEl.alt = titleText;
            }
        }
        if (isStale()) return;

        const titleEl = field(root, "recipe-title");
        if (titleEl) titleEl.innerText = titleText;

        const descEl = field(root, "recipe-description");
        if (descEl) descEl.innerText = recipe.description || "";

        const caloriesEl = field(root, "recipe-calories");
        if (caloriesEl) caloriesEl.innerText = recipe.kalories ? `${recipe.kalories} ккал` : "";

        const timeEl = field(root, "recipe-time");
        if (timeEl) timeEl.innerText = recipe.cooking_time || "0";

        const weightEl = field(root, "recipe-weight");
        if (weightEl) weightEl.innerText = recipe.final_weight || "0";

        const belkiEl = field(root, "recipe-belki");
        if (belkiEl) belkiEl.innerText = recipe.belki || "0";

        const fatsEl = field(root, "recipe-fats");
        if (fatsEl) fatsEl.innerText = recipe.fats || "0";

        const uglevodsEl = field(root, "recipe-uglevods");
        if (uglevodsEl) uglevodsEl.innerText = recipe.uglevods || "0";

        const starsContainer = field(root, "recipe-stars");
        if (starsContainer) {
            const starsCount = Math.max(0, Math.min(5, Number(recipe.stars) || 0));
            starsContainer.innerHTML = "";
            for (let i = 0; i < starsCount; i++) {
                const starImg = document.createElement("img");
                starImg.className = "star-icon";
                starImg.src = starSrc;
                starImg.alt = "★";
                starsContainer.appendChild(starImg);
            }
        }

        if (isStale()) return;

        const equipmentContainer = field(root, "recipe-equipment");
        if (equipmentContainer) {
            equipmentContainer.innerHTML = "";
            if (Array.isArray(recipe.equipment) && recipe.equipment.length > 0) {
                const prefs = await loadUserPreferences();
                const userEquipment = Array.isArray(prefs && prefs.kitchen_equipment) ? prefs.kitchen_equipment : [];

                recipe.equipment.forEach((rawKey) => {
                    const itemKey = String(rawKey || "").trim();
                    if (!itemKey) return;

                    const pill = document.createElement("div");
                    const isAvailable = userEquipment.includes(itemKey);
                    pill.className = `equipment-pill ${isAvailable ? "available" : "unavailable"}`;
                    pill.innerText = EQUIPMENT_TRANSLATIONS[itemKey] || itemKey;
                    equipmentContainer.appendChild(pill);
                });
            }
        }

        const ingredientsContainer = field(root, "recipe-ingredients");
        if (ingredientsContainer) {
            ingredientsContainer.innerHTML = "";
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

                    li.appendChild(nameSpan);
                    li.appendChild(dotsSpan);
                    li.appendChild(amountSpan);
                    ingredientsContainer.appendChild(li);
                });
            } else {
                ingredientsContainer.innerHTML = `<li class="ingredient-item">Список продуктов не указан</li>`;
            }
        }

        if (isStale()) return;

        const stepsContainer = field(root, "recipe-hyper-text");
        if (stepsContainer) {
            if (loadHyperText) {
                if (isStale()) return;
                await loadHyperTextContent(recipe["hyper-text"] || recipe.hyper_text || "", stepsContainer);
            } else {
                stepsContainer.innerHTML = "";
                stepsContainer.innerText = hyperTextPlaceholder;
            }
        }
    }

    global.RecipeCard = {
        formatIngredientMeasure,
        loadHyperTextContent,
        fill
    };
})(window);
