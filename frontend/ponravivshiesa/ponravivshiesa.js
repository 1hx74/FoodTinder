/* global window, document, AuthAPI */

(function () {
  "use strict";

  const BATCH_SIZE = 5;
  let allLikedIds = null;
  let loadedCount = 0;
  let isLoadingBatch = false;
  let hasMore = true;

  const EQUIPMENT_TRANSLATIONS = { oven: "Духовка", stove: "Плита", microwave: "Микроволновка", multicooker: "Мультиварка", air_fryer: "Аэрогриль", toaster: "Тостер", waffle_maker: "Вафельница", mixer: "Миксер", blender: "Блендер", meat_grinder: "Мясорубка", backing_dish: "Форма для запекания", backind_sheet: "Противень", grater: "Терка", wisk: "Венчик", rolling_scale: "Скалка", pot: "Кастрюля" };
  const UNIT_DICTIONARY = { "g": "гр", "gr": "гр", "gram": "гр", "gramm": "гр", "гр": "гр", "ml": "мл", "milliliter": "мл", "milliliters": "мл", "мл": "мл", "it": "шт", "item": "шт", "items": "шт", "шт": "шт", "kg": "кг", "kilogram": "кг", "кг": "кг", "l": "л", "liter": "л", "liters": "л", "л": "л", "tsp": "ч. л.", "tbsp": "ст. л.", "cup": "ст." };

  function formatIngredientMeasure(rawQuantity, rawCount) {
    const key = String(rawQuantity || "").trim().toLowerCase();
    const unit = UNIT_DICTIONARY[key] || rawQuantity || "";
    const count = Number(rawCount);
    if (Number.isNaN(count) || count <= 0) return unit;
    if (unit === "гр" && count >= 1000) return `${Number((count / 1000).toFixed(2))} кг`;
    if (unit === "мл" && count >= 1000) return `${Number((count / 1000).toFixed(2))} л`;
    return `${count} ${unit}`.trim();
  }

  async function loadHyperTextContent(hyperTextValue, containerEl) {
    if (!containerEl) return;
    const value = String(hyperTextValue || "").trim();
    if (value.startsWith("http") || value.endsWith(".html") || value.endsWith(".htm")) {
      containerEl.innerHTML = "Загрузка рецепта...";
      try {
        const response = await fetch(value);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        containerEl.innerHTML = await response.text();
      } catch (err) {
        containerEl.innerText = "Не удалось загрузить инструкции по приготовлению.";
      }
    } else {
      containerEl.innerText = value || "Инструкция приготовления отсутствует.";
    }
  }

  function createRecipeCard(recipe, userEquipment = []) {
    const card = document.createElement("article");
    card.className = "frame-16";

    // Кнопка удаления (крестик)
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-favorite-btn";
    removeBtn.title = "Удалить из понравившихся";
    removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeBtn.disabled = true;
      
      try {
        await AuthAPI.removeFromLiked(recipe.recipe_id);
        card.style.transition = "all 0.3s ease";
        card.style.opacity = "0";
        card.style.transform = "scale(0.9)";
        setTimeout(() => {
          card.remove();
          checkAndLoadMore();
        }, 300);
      } catch (error) {
        console.error("Не удалось удалить лайк:", error);
        alert("Ошибка при удалении. Попробуйте позже.");
        removeBtn.disabled = false;
      }
    });
    card.appendChild(removeBtn);

    const titleText = recipe.title || "Без названия";
    const fallbackPlaceholder = `https://placehold.co/600x400?text=${encodeURIComponent(titleText)}`;
    const imageUrl = recipe.image_url || fallbackPlaceholder;

    const img = document.createElement("img");
    img.className = "rectangle-14";
    img.src = imageUrl;
    img.alt = titleText;
    img.loading = "lazy";
    img.onerror = () => { img.src = fallbackPlaceholder; };

    const inner = document.createElement("div");
    inner.className = "recipe-inner-content";

    const textBlock = document.createElement("div");
    textBlock.className = "div7";
    textBlock.innerHTML = `<div class="recipe-title">${titleText}</div><div class="recipe-desc">${recipe.description || ""}</div>`;

    const metaCol = document.createElement("div");
    metaCol.className = "recipe-meta-column";

    const row1 = document.createElement("div");
    row1.className = "recipe-meta-row";
    const starsCount = Math.max(0, Math.min(5, Number(recipe.stars) || 0));
    let starsHtml = '';
    for (let i = 0; i < starsCount; i++) {
        starsHtml += `<span class="star-icon"><svg width="18" height="18" viewBox="0 0 22 20" fill="#FFB800" xmlns="http://www.w3.org/2000/svg"><path d="M11 0L13.4697 7.60081H21.4616L14.996 12.2984L17.4656 19.8992L11 15.2016L4.53436 19.8992L7.00402 12.2984L0.538379 7.60081H8.53035L11 0Z"/></svg></span>`;
    }
    row1.innerHTML = `<div class="difficulty-box"><span class="meta-label">Сложность:</span><div class="stars-row">${starsHtml}</div></div><div class="calories-box">${recipe.kalories ? `${recipe.kalories} ккал` : ""}</div>`;

    const row2 = document.createElement("div");
    row2.className = "recipe-meta-row info-row";
    row2.innerHTML = `<span>⏱ ${recipe.cooking_time || 0} мин</span><span>⚖ ${recipe.final_weight || 0} г</span>`;

    const row3 = document.createElement("div");
    row3.className = "recipe-meta-row macros-row";
    row3.innerHTML = `<span>Белки: ${recipe.belki || 0} г</span><span>Жиры: ${recipe.fats || 0} г</span><span>Углеводы: ${recipe.uglevods || 0} г</span>`;

    metaCol.append(row1, row2, row3);

    let equipmentSection = null;
    if (Array.isArray(recipe.equipment) && recipe.equipment.length > 0) {
      equipmentSection = document.createElement("div");
      equipmentSection.className = "equipment-section";
      const eqWrap = document.createElement("div");
      eqWrap.className = "equipment-container";
      recipe.equipment.forEach(rawKey => {
        const key = String(rawKey || "").trim();
        if (!key) return;
        const pill = document.createElement("div");
        pill.className = `equipment-pill ${userEquipment.includes(key) ? "available" : "unavailable"}`;
        pill.innerText = EQUIPMENT_TRANSLATIONS[key] || key;
        eqWrap.appendChild(pill);
      });
      equipmentSection.innerHTML = `<div class="meta-label">Оборудование:</div>`;
      equipmentSection.appendChild(eqWrap);
    }

    const expandable = document.createElement("div");
    expandable.className = "expandable-section";
    
    const ingSection = document.createElement("div");
    ingSection.className = "ingredients-section";
    let ingHtml = `<div class="meta-label">Ингредиенты:</div><ul class="ingredients-list">`;
    if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
      recipe.ingredients.forEach(item => {
        ingHtml += `<li class="ingredient-item"><span class="ingredient-name">${item.name}</span><span class="ingredient-dots"></span><span class="ingredient-amount">${formatIngredientMeasure(item.quantity, item.count)}</span></li>`;
      });
    } else {
      ingHtml += `<li class="ingredient-item">Список продуктов не указан</li>`;
    }
    ingHtml += `</ul>`;
    ingSection.innerHTML = ingHtml;

    const stepsSection = document.createElement("div");
    stepsSection.className = "recipe-steps-section";
    stepsSection.innerHTML = `<div class="meta-label">Способ приготовления:</div><div class="recipe-steps-text"></div>`;
    const stepsText = stepsSection.querySelector(".recipe-steps-text");

    expandable.append(ingSection, stepsSection);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "div5";
    toggleBtn.innerHTML = `<span class="div6">Посмотреть рецепт</span>`;

    let stepsLoaded = false;
    toggleBtn.addEventListener("click", async () => {
      const isExpanded = card.classList.toggle("expanded");
      const btnLabel = toggleBtn.querySelector(".div6");
      if (btnLabel) btnLabel.innerText = isExpanded ? "Назад" : "Посмотреть рецепт";
      if (isExpanded && !stepsLoaded) {
        stepsLoaded = true;
        const rawHyperText = recipe["hyper-text"] || recipe.hyper_text;
        await loadHyperTextContent(rawHyperText, stepsText);
      }
    });

    inner.append(textBlock, metaCol);
    if (equipmentSection) inner.appendChild(equipmentSection);
    inner.append(expandable, toggleBtn);
    card.append(img, inner);
    return card;
  }

  async function loadNextBatch() {
    if (isLoadingBatch || !hasMore) return;
    isLoadingBatch = true;
    const listEl = document.getElementById("recipes-list");
    const sentinelEl = document.getElementById("loading-sentinel");
    const emptyEl = document.getElementById("empty-state");
    if (sentinelEl) sentinelEl.style.display = "block";

    try {
      let userEq = [];
      try { userEq = JSON.parse(localStorage.getItem("global_cache_equipment"))?.kitchen_equipment || []; } catch(e){}

      if (allLikedIds === null) {
        // Получаем список лайкнутых ID
        const response = await rawRequest("/api/db/recipes/liked", { method: "GET" });
        allLikedIds = Array.isArray(response) ? response : (response?.recipes || []);
      }

      if (allLikedIds.length === 0) {
        hasMore = false;
        if (emptyEl) emptyEl.style.display = "flex";
        if (sentinelEl) sentinelEl.style.display = "none";
        return;
      }

      const slice = allLikedIds.slice(loadedCount, loadedCount + BATCH_SIZE);
      loadedCount += slice.length;
      if (loadedCount >= allLikedIds.length) hasMore = false;

      const fullRecipes = await Promise.all(slice.map(async (item) => {
        const id = typeof item === "object" ? item.recipe_id : item;
        try { return await window.AuthAPI.getRecipeById(id); } catch { return null; }
      }));

      fullRecipes.filter(Boolean).forEach(recipe => {
        if (listEl) listEl.appendChild(createRecipeCard(recipe, userEq));
      });

    } catch (error) {
      console.error("Ошибка загрузки:", error);
    } finally {
      isLoadingBatch = false;
      if (sentinelEl) sentinelEl.style.display = hasMore ? "block" : "none";
    }
  }

  function checkAndLoadMore() {
    if (!hasMore || isLoadingBatch) return;
    const sentinelEl = document.getElementById("loading-sentinel");
    if (!sentinelEl) return;
    if (sentinelEl.getBoundingClientRect().top <= window.innerHeight + 300) {
      loadNextBatch().then(() => { if (hasMore) setTimeout(checkAndLoadMore, 100); });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.AuthAPI || !window.AuthAPI.isAuthenticated()) {
      window.location.href = "../vxod/index.html";
      return;
    }
    await loadNextBatch();
    checkAndLoadMore();
    window.addEventListener("scroll", checkAndLoadMore, { passive: true });
  });
})();