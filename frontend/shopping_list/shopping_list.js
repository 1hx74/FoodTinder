(function () {
    "use strict";

    const PLANNER_STORAGE_KEY = "foodtinder_planner_days";
    const SHOPPING_CHECKED_KEY = "foodtinder_shopping_checked_v1";
    const RECIPE_FETCH_CONCURRENCY = 6;
    const UNIT_LABELS = { gramm: "г", milliliter: "мл", item: "шт" };

    const recipeDetailsCache = new Map();
    let shoppingItems = [];
    let shoppingCopyTimer = null;

    function normalizePlannedRecipe(raw) {
        if (!raw || typeof raw !== "object") return null;
        const finalWeight = Math.max(1, Number(raw.final_weight) || 100);
        let weight = Number(raw.weight);
        if (!(weight > 0)) weight = finalWeight;
        return {
            recipe_id: raw.recipe_id ?? raw.id ?? null,
            title: raw.title || raw.name || "Блюдо",
            final_weight: finalWeight,
            weight
        };
    }

    function loadDaysFromCache() {
        try {
            const raw = localStorage.getItem(PLANNER_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((d) => ({
                recipes: (Array.isArray(d?.recipes) ? d.recipes : [])
                    .map(normalizePlannedRecipe)
                    .filter(Boolean)
            }));
        } catch (err) {
            console.warn("[shopping_list.js] Ошибка чтения кэша планировщика:", err);
            return [];
        }
    }

    async function mapPool(items, limit, fn) {
        const out = new Array(items.length);
        let next = 0;
        async function worker() {
            while (next < items.length) {
                const idx = next++;
                out[idx] = await fn(items[idx], idx);
            }
        }
        const n = Math.max(1, Math.min(limit, items.length));
        await Promise.all(Array.from({ length: n }, () => worker()));
        return out;
    }

    async function getRecipeDetailsCached(id) {
        if (recipeDetailsCache.has(id)) return recipeDetailsCache.get(id);
        const pending = window.AuthAPI.getRecipeById(id)
            .then((data) => {
                recipeDetailsCache.set(id, data);
                return data;
            })
            .catch(() => {
                recipeDetailsCache.delete(id);
                return null;
            });
        recipeDetailsCache.set(id, pending);
        return pending;
    }

    function normalizeIngredientUnit(quantity) {
        const q = String(quantity || "").trim().toLowerCase();
        if (q === "gramm" || q === "g" || q === "гр" || q === "г") return "gramm";
        if (q === "milliliter" || q === "ml" || q === "мл") return "milliliter";
        if (q === "item" || q === "шт" || q === "шт." || q === "pcs") return "item";
        return q;
    }

    function unitLabel(unit) {
        return UNIT_LABELS[unit] || unit || "";
    }

    function formatDisplayQuantity(item) {
        if (!item) return "";
        if (item.qualitative || !Number.isFinite(item.amount)) {
            return "по вкусу";
        }
        let value = item.amount;
        let label = unitLabel(item.unit);

        if (item.unit === "gramm" && Math.abs(value) >= 1000) {
            value = value / 1000;
            label = "кг";
        } else if (item.unit === "milliliter" && Math.abs(value) >= 1000) {
            value = value / 1000;
            label = "л";
        }

        const formatted = formatAmount(value);
        return label ? `${formatted} ${label}` : formatted;
    }

    function formatAmount(value) {
        if (!Number.isFinite(value)) return "";
        const abs = Math.abs(value);
        let rounded;
        if (abs >= 100) rounded = Math.round(value);
        else if (abs >= 10) rounded = Math.round(value * 10) / 10;
        else rounded = Math.round(value * 100) / 100;
        if (Number.isInteger(rounded)) return String(rounded);
        return String(parseFloat(rounded.toFixed(2)));
    }

    function formatShoppingLine(item) {
        if (!item) return "";
        if (item.qualitative || !Number.isFinite(item.amount)) {
            return `• ${item.name} — по вкусу`;
        }
        return `• ${item.name} — ${formatDisplayQuantity(item)}`;
    }

    function loadShoppingChecked() {
        try {
            const raw = JSON.parse(localStorage.getItem(SHOPPING_CHECKED_KEY) || "[]");
            return new Set(Array.isArray(raw) ? raw.map(String) : []);
        } catch (_) {
            return new Set();
        }
    }

    function saveShoppingChecked(keys) {
        localStorage.setItem(SHOPPING_CHECKED_KEY, JSON.stringify([...keys]));
    }

    function aggregateShoppingItems(entries) {
        const numeric = new Map();
        const qualitative = new Map();
        (entries || []).forEach((entry) => {
            const details = entry && entry.details;
            if (!details) return;
            const finalWeight = Math.max(1, Number(details.final_weight ?? entry.final_weight) || 100);
            const planned = Number(entry.weight) > 0 ? Number(entry.weight) : finalWeight;
            const scale = planned / finalWeight;
            const ingredients = Array.isArray(details.ingredients) ? details.ingredients : [];
            ingredients.forEach((ing) => {
                const name = String(ing && (ing.name || ing.title) || "").trim();
                if (!name) return;
                const unit = normalizeIngredientUnit(ing.quantity ?? ing.unit);
                const rawAmount = ing.count ?? ing.amount;
                const amount = Number(rawAmount);
                const nameKey = name.toLocaleLowerCase("ru-RU");
                if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "" && Number.isFinite(amount) && amount > 0) {
                    const key = `${nameKey}|${unit}`;
                    const prev = numeric.get(key);
                    if (prev) prev.amount += amount * scale;
                    else numeric.set(key, { key, name, unit, amount: amount * scale });
                } else {
                    const key = `${nameKey}|taste`;
                    if (!qualitative.has(key)) qualitative.set(key, { key, name, qualitative: true });
                }
            });
        });
        const items = [...numeric.values(), ...qualitative.values()];
        items.sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
        return items;
    }

    function shoppingListText() {
        return shoppingItems.map(formatShoppingLine).join("\n");
    }

    function renderShoppingItems(items, bodyEl, actionsEl, copyBtnEl) {
        shoppingItems = items || [];
        if (!bodyEl) return;
        const cardEl = bodyEl.closest(".shopping-card");
        bodyEl.innerHTML = "";
        if (copyBtnEl) copyBtnEl.textContent = "Скопировать";
        if (shoppingCopyTimer) {
            clearTimeout(shoppingCopyTimer);
            shoppingCopyTimer = null;
        }
        if (!shoppingItems.length) {
            cardEl?.classList.add("is-empty");
            const empty = document.createElement("p");
            empty.className = "shopping-empty";
            empty.textContent = "В плане пока нет рецептов.";
            bodyEl.appendChild(empty);
            if (actionsEl) actionsEl.hidden = true;
            return;
        }
        cardEl?.classList.remove("is-empty");
        const checked = loadShoppingChecked();
        const kept = new Set();
        shoppingItems.forEach((item) => {
            const label = document.createElement("label");
            label.className = "shopping-item" + (checked.has(item.key) ? " is-checked" : "");
            const box = document.createElement("input");
            box.type = "checkbox";
            box.className = "shopping-item-check";
            box.checked = checked.has(item.key);
            box.addEventListener("change", () => {
                if (box.checked) checked.add(item.key);
                else checked.delete(item.key);
                label.classList.toggle("is-checked", box.checked);
                const current = new Set();
                shoppingItems.forEach((row) => {
                    if (checked.has(row.key)) current.add(row.key);
                });
                saveShoppingChecked(current);
            });
            if (checked.has(item.key)) kept.add(item.key);
            const name = document.createElement("span");
            name.className = "shopping-item-name";
            name.textContent = item.name;
            const amount = document.createElement("span");
            amount.className = "shopping-item-amount";
            amount.textContent = formatDisplayQuantity(item);
            label.appendChild(box);
            label.appendChild(name);
            label.appendChild(amount);
            bodyEl.appendChild(label);
        });
        saveShoppingChecked(kept);
        if (actionsEl) actionsEl.hidden = false;
    }

    async function initShoppingList(bodyEl, actionsEl, copyBtnEl) {
        if (!bodyEl) return;
        bodyEl.innerHTML = "";
        const status = document.createElement("p");
        status.className = "shopping-status";
        status.textContent = "Собираем список…";
        bodyEl.appendChild(status);
        if (actionsEl) actionsEl.hidden = true;

        const days = loadDaysFromCache();
        const planned = [];
        days.forEach((day) => {
            (day.recipes || []).forEach((recipe) => {
                const norm = normalizePlannedRecipe(recipe);
                if (norm && norm.recipe_id != null) planned.push(norm);
            });
        });

        if (!planned.length) {
            renderShoppingItems([], bodyEl, actionsEl, copyBtnEl);
            return;
        }
        if (!window.AuthAPI || typeof window.AuthAPI.getRecipeById !== "function") {
            bodyEl.innerHTML = "";
            const err = document.createElement("p");
            err.className = "shopping-status";
            err.textContent = "Не удалось загрузить ингредиенты.";
            bodyEl.appendChild(err);
            return;
        }

        try {
            const uniqueIds = [...new Set(planned.map((r) => r.recipe_id))];
            const detailsList = await mapPool(uniqueIds, RECIPE_FETCH_CONCURRENCY, (id) => getRecipeDetailsCached(id));
            const byId = new Map();
            uniqueIds.forEach((id, idx) => { byId.set(id, detailsList[idx]); });
            const entries = planned.map((recipe) => ({
                weight: recipe.weight,
                final_weight: recipe.final_weight,
                details: byId.get(recipe.recipe_id)
            }));
            renderShoppingItems(aggregateShoppingItems(entries), bodyEl, actionsEl, copyBtnEl);
        } catch (_) {
            bodyEl.innerHTML = "";
            const err = document.createElement("p");
            err.className = "shopping-status";
            err.textContent = "Не удалось загрузить ингредиенты.";
            bodyEl.appendChild(err);
        }
    }

    async function copyShoppingList(copyBtnEl) {
        const text = shoppingListText();
        if (!text) return;
        let copied = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                copied = true;
            }
        } catch (_) {}
        if (!copied) {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:-9999px;top:0;";
            document.body.appendChild(ta);
            ta.select();
            try {
                copied = document.execCommand("copy");
            } catch (_) {
                copied = false;
            }
            ta.remove();
        }
        if (copied && copyBtnEl) {
            copyBtnEl.textContent = "Скопировано";
            if (shoppingCopyTimer) clearTimeout(shoppingCopyTimer);
            shoppingCopyTimer = setTimeout(() => {
                copyBtnEl.textContent = "Скопировать";
                shoppingCopyTimer = null;
            }, 1600);
        }
    }

    async function shareShoppingList() {
        const text = shoppingListText();
        if (!text) return;
        const title = "Список покупок";
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title, text });
                return;
            } catch (err) {
                if (err && err.name === "AbortError") return;
            }
        }
        const pageUrl = (window.location.protocol === "http:" || window.location.protocol === "https:")
            ? `${window.location.origin}${window.location.pathname}`
            : "";
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`;
        window.open(shareUrl, "_blank", "noopener,noreferrer");
    }

    document.addEventListener("DOMContentLoaded", () => {
        const bodyEl = document.getElementById("shopping-list-body");
        const actionsEl = document.getElementById("shopping-list-actions");
        const shareBtn = document.getElementById("shopping-share-btn");
        const copyBtn = document.getElementById("shopping-copy-btn");

        shareBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            shareShoppingList();
        });
        copyBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            copyShoppingList(copyBtn);
        });

        initShoppingList(bodyEl, actionsEl, copyBtn);
    });
})();