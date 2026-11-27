/**
- ДЛЯ ЧЕГО: Контроллер страницы планировщика питания (работает только с локальным кэшем localStorage).
- Управляет добавлением/удалением дней с авто-пересчётом номеров,
- ручным вводом дня недели справа, удалением блюд внутри дня,
- выбором уровня активности и расчётом дневной нормы КБЖУ.
 */

const SCHEDULER_STORAGE_KEY = "foodtinder_scheduler_days_v1";
const LIFESTYLE_CACHE_KEY = "foodtinder_user_lifestyle_v1";
const DEFAULT_CALC_BTN_TEXT = "Рассчитать дневную норму КБЖУ";
const PROFILE_PAGE_HREF = "../osnov_inform_user/index.html";
const LOGIN_PAGE_HREF = "../vxod/index.html";

// Mifflin–St Jeor: BMR × коэффициент активности, затем цель:
// поддержание ×1.0, набор +15% ккал, сброс −15% ккал.
// Белки: 1.8 г/кг при поддержании, 2.0 г/кг при наборе и сбросе.
const ACTIVITY_LEVELS = {
    1: { factor: 1.2, title: "Минимальная" },
    2: { factor: 1.375, title: "Лёгкая" },
    3: { factor: 1.55, title: "Средняя" },
    4: { factor: 1.725, title: "Высокая" },
    5: { factor: 1.9, title: "Очень высокая" }
};
const DEFAULT_GOAL = "maintain";
const GOALS = {
    maintain: { kcalFactor: 1.0, proteinPerKg: 1.8, title: "Поддержание" },
    gain: { kcalFactor: 1.15, proteinPerKg: 2.0, title: "Набор веса" },
    loss: { kcalFactor: 0.85, proteinPerKg: 2.0, title: "Сброс веса" }
};

function loadPlannerPrefs() {
    try {
        const raw = localStorage.getItem(LIFESTYLE_CACHE_KEY);
        if (!raw) return { lifeType: null, goal: DEFAULT_GOAL };
        const parsed = JSON.parse(raw);
        const value = Number(typeof parsed === "object" && parsed !== null ? parsed.life_type : parsed);
        const lifeType = ACTIVITY_LEVELS[value] ? value : null;
        const goalRaw = typeof parsed === "object" && parsed !== null ? parsed.goal : null;
        const goal = GOALS[goalRaw] ? goalRaw : DEFAULT_GOAL;
        return { lifeType, goal };
    } catch (_) {
        return { lifeType: null, goal: DEFAULT_GOAL };
    }
}

function savePlannerPrefs(patch = {}) {
    const current = loadPlannerPrefs();
    const nextLife = Object.prototype.hasOwnProperty.call(patch, "lifeType")
        ? (ACTIVITY_LEVELS[Number(patch.lifeType)] ? Number(patch.lifeType) : current.lifeType)
        : current.lifeType;
    const nextGoal = Object.prototype.hasOwnProperty.call(patch, "goal")
        ? (GOALS[patch.goal] ? patch.goal : current.goal)
        : current.goal;
    try {
        localStorage.setItem(LIFESTYLE_CACHE_KEY, JSON.stringify({
            life_type: nextLife,
            goal: nextGoal
        }));
    } catch (_) {}
    return { lifeType: nextLife, goal: nextGoal };
}

function ageFromBirthDate(birthDateStr) {
    if (!birthDateStr) return null;
    const birth = new Date(`${birthDateStr}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age -= 1;
    }
    if (age < 10 || age > 100) return null;
    return age;
}

function parseProfileForNorm(profile) {
    if (!profile || typeof profile !== "object") return { ok: false, missing: ["профиль"] };
    const missing = [];
    const age = ageFromBirthDate(profile.birth_date);
    if (age == null) missing.push("дату рождения");
    const gender = profile.gender === "men" || profile.gender === "women" ? profile.gender : null;
    if (!gender) missing.push("пол");
    const height = Number(profile.height);
    if (!(height >= 50 && height <= 250)) missing.push("рост");
    const weight = Number(profile.weight);
    if (!(weight >= 20 && weight <= 300)) missing.push("вес");
    if (missing.length) return { ok: false, missing };
    return { ok: true, age, gender, height, weight };
}

function calculateDailyNorm({ weight, height, gender, age, lifeType, goal }) {
    const level = ACTIVITY_LEVELS[lifeType];
    const goalInfo = GOALS[goal] || GOALS[DEFAULT_GOAL];
    if (!level) return null;
    const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === "men" ? 5 : -161);
    const calories = Math.max(0, Math.round(bmr * level.factor * goalInfo.kcalFactor));
    const protein = Math.round(goalInfo.proteinPerKg * weight);
    return { calories, protein };
}

function formatNormLabel(norm) {
    return `Дневная норма: ${norm.calories} ккал · белки ${norm.protein} г`;
}

const SEARCH_DEBOUNCE_MS = 300;
const RECIPE_FETCH_CONCURRENCY = 6;
const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.41l-2.51-2.51a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 2z"/></svg>';

const recipeDetailsCache = new Map();
const searchQueryCache = new Map();

function searchKey(query) {
    return String(query || "").trim().toLowerCase();
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


function normalizePlannedRecipe(raw) {
    if (!raw || typeof raw !== "object") return null;
    const kalories = Number(raw.kalories ?? raw.calories ?? 0) || 0;
    const belki = Number(raw.belki ?? raw.protein ?? 0) || 0;
    const fats = Number(raw.fats ?? raw.fat ?? 0) || 0;
    const uglevods = Number(raw.uglevods ?? raw.carbs ?? 0) || 0;
    const finalWeight = Math.max(1, Number(raw.final_weight) || 100);
    let weight = Number(raw.weight);
    if (!(weight > 0)) weight = finalWeight;
    return {
        recipe_id: raw.recipe_id ?? raw.id ?? null,
        title: raw.title || raw.name || "Блюдо",
        kalories,
        belki,
        fats,
        uglevods,
        final_weight: finalWeight,
        weight
    };
}

function portionOf(recipe) {
    const item = normalizePlannedRecipe(recipe) || {
        kalories: 0, belki: 0, fats: 0, uglevods: 0, weight: 0
    };
    const scale = item.weight / 100;
    return {
        calories: item.kalories * scale,
        protein: item.belki * scale,
        fat: item.fats * scale,
        carbs: item.uglevods * scale,
        weight: item.weight
    };
}

function formatKbjuLine(totals) {
    return `${Math.round(totals.calories)} ккал · Б ${Math.round(totals.protein)} · Ж ${Math.round(totals.fat)} · У ${Math.round(totals.carbs)}`;
}


const SHOPPING_CHECKED_KEY = "foodtinder_shopping_checked_v1";
const UNIT_LABELS = { gramm: "г", milliliter: "мл", item: "шт" };

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
    const amount = formatAmount(item.amount);
    const unit = unitLabel(item.unit);
    return unit ? `• ${item.name} — ${amount} ${unit}` : `• ${item.name} — ${amount}`;
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

function recipeFromApi(data) {
    return normalizePlannedRecipe({
        recipe_id: data.recipe_id ?? data.id,
        title: data.title,
        kalories: data.kalories,
        belki: data.belki,
        fats: data.fats,
        uglevods: data.uglevods,
        final_weight: data.final_weight
    });
}

class DayNutritionCalculator {
    calculate(recipes = []) {
        return (recipes || []).reduce(
            (acc, item) => {
                const portion = portionOf(item);
                acc.calories += portion.calories;
                acc.protein += portion.protein;
                acc.fat += portion.fat;
                acc.carbs += portion.carbs;
                return acc;
            },
            { calories: 0, protein: 0, fat: 0, carbs: 0 }
        );
    }

    formatSummary(recipes = []) {
        const totals = this.calculate(recipes);
        return `КБЖУ: ${formatKbjuLine(totals)}`;
    }

    formatMeal(recipe) {
        return formatKbjuLine(portionOf(recipe));
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const lifestyleModal = document.getElementById("lifestyle-modal");
    const lifeTypeOptions = Array.from(document.querySelectorAll(".lifestyle-option"));
    const calcNormBtn = document.getElementById("calc-norm-btn");
    const missingEl = document.getElementById("lifestyle-missing");
    const lifeTypeList = document.getElementById("life_type");
    const profileLink = document.getElementById("lifestyle-profile-link");
    const goalBlock = document.getElementById("goal-block");
    const goalOptions = Array.from(document.querySelectorAll(".goal-option"));
    let selectedLifeType = loadPlannerPrefs().lifeType;
    let profileState = { loaded: false, loggedIn: false, parsed: null };

    function isLoggedIn() {
        return Boolean(window.AuthAPI && typeof window.AuthAPI.isAuthenticated === "function" && window.AuthAPI.isAuthenticated());
    }

    function syncLifeTypeUI(lifeType) {
        const normalized = ACTIVITY_LEVELS[Number(lifeType)] ? Number(lifeType) : null;
        selectedLifeType = normalized;
        lifeTypeOptions.forEach((btn) => {
            const isSelected = Number(btn.dataset.lifeType) === normalized;
            btn.classList.toggle("is-selected", isSelected);
            btn.setAttribute("aria-checked", String(isSelected));
        });
    }

    function syncGoalUI(goal) {
        const normalized = GOALS[goal] ? goal : DEFAULT_GOAL;
        goalOptions.forEach((btn) => {
            const isSelected = btn.dataset.goal === normalized;
            btn.classList.toggle("is-selected", isSelected);
            btn.setAttribute("aria-checked", String(isSelected));
        });
    }

    function applyNormToButton(norm) {
        if (!calcNormBtn) return;
        if (norm) {
            calcNormBtn.textContent = formatNormLabel(norm);
        } else {
            calcNormBtn.textContent = DEFAULT_CALC_BTN_TEXT;
        }
        calcNormBtn.disabled = false;
    }

    function renderModalState() {
        const loggedIn = profileState.loggedIn;
        const parsed = profileState.parsed;

        if (!loggedIn) {
            if (missingEl) {
                missingEl.hidden = false;
                missingEl.innerHTML = `Чтобы рассчитать норму, <a href="${LOGIN_PAGE_HREF}">войдите в аккаунт</a> и укажите в профиле пол, дату рождения, рост и вес.`;
            }
            if (lifeTypeList) lifeTypeList.hidden = true;
            if (goalBlock) goalBlock.hidden = true;
            if (profileLink) profileLink.hidden = true;
            return false;
        }

        if (!parsed || !parsed.ok) {
            const fields = (parsed && parsed.missing ? parsed.missing : ["данные профиля"]).join(", ");
            if (missingEl) {
                missingEl.hidden = false;
                missingEl.innerHTML = `Не хватает данных: ${fields}. <a href="${PROFILE_PAGE_HREF}">Заполнить в профиле</a>`;
            }
            if (lifeTypeList) lifeTypeList.hidden = true;
            if (goalBlock) goalBlock.hidden = true;
            if (profileLink) {
                profileLink.hidden = false;
                profileLink.href = PROFILE_PAGE_HREF;
                profileLink.textContent = "Данные устарели? Обновить в профиле";
            }
            return false;
        }

        if (missingEl) {
            missingEl.hidden = true;
            missingEl.textContent = "";
        }
        if (lifeTypeList) lifeTypeList.hidden = false;
        if (goalBlock) goalBlock.hidden = false;
        if (profileLink) {
            profileLink.hidden = false;
            profileLink.href = PROFILE_PAGE_HREF;
            profileLink.textContent = "Данные устарели? Обновить в профиле";
        }
        return true;
    }

    async function loadProfileForNorm() {
        profileState.loggedIn = isLoggedIn();
        profileState.loaded = true;
        profileState.parsed = null;
        if (!profileState.loggedIn) return profileState;

        let profile = null;
        try {
            if (window.AuthAPI && typeof window.AuthAPI.getProfile === "function") {
                profile = await window.AuthAPI.getProfile();
            }
        } catch (err) {
            if (err && err.status === 401) {
                profileState.loggedIn = false;
                return profileState;
            }
            try {
                if (window.AuthAPI && typeof window.AuthAPI.getCachedProfile === "function") {
                    profile = await window.AuthAPI.getCachedProfile();
                }
            } catch (_) {}
            if (!profile) {
                profileState.parsed = { ok: false, missing: ["данные профиля (не удалось загрузить)"] };
                return profileState;
            }
        }
        profileState.parsed = parseProfileForNorm(profile);
        return profileState;
    }

    function tryApplySavedNorm() {
        const prefs = loadPlannerPrefs();
        if (!prefs.lifeType || !profileState.parsed || !profileState.parsed.ok) {
            applyNormToButton(null);
            return false;
        }
        const norm = calculateDailyNorm({ ...profileState.parsed, lifeType: prefs.lifeType, goal: prefs.goal });
        applyNormToButton(norm);
        return Boolean(norm);
    }


    let pageScrollY = 0;
    let pageScrollLocked = false;

    function lockPageScroll() {
        if (pageScrollLocked) return;
        pageScrollY = window.scrollY;
        document.documentElement.classList.add("is-modal-open");
        document.body.classList.add("is-modal-open");
        pageScrollLocked = true;
    }

    function unlockPageScroll() {
        if (!pageScrollLocked) return;
        document.documentElement.classList.remove("is-modal-open");
        document.body.classList.remove("is-modal-open");
        pageScrollLocked = false;
        window.scrollTo(0, pageScrollY);
    }

    function openLifestyleModal() {
        const prefs = loadPlannerPrefs();
        syncLifeTypeUI(prefs.lifeType);
        syncGoalUI(prefs.goal);
        const modal = document.getElementById("lifestyle-modal");
        if (!modal) {
            console.warn("[sheduler.js] #lifestyle-modal не найден в DOM");
            return;
        }
        renderModalState();
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        lockPageScroll();
        modal.style.cssText = [
            "position: fixed",
            "inset: 0",
            "width: 100vw",
            "height: 100vh",
            "background-color: rgba(0, 0, 0, 0.5)",
            "display: flex",
            "align-items: center",
            "justify-content: center",
            "padding: 20px",
            "z-index: 99999"
        ].join(" !important; ") + " !important;";

        const card = modal.querySelector(".lifestyle-modal");
        if (card) {
            card.style.cssText = [
                "background-color: #ffffff",
                "border-radius: 12px",
                "padding: 16px",
                "width: 100%",
                "max-width: 352px",
                "display: flex",
                "flex-direction: column",
                "gap: 12px",
                "box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25)",
                "position: relative",
                "z-index: 100000"
            ].join(" !important; ") + " !important;";
        }
    }

    function closeLifestyleModal() {
        const modal = document.getElementById("lifestyle-modal");
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        modal.style.cssText = "display: none !important;";
        unlockPageScroll();
    }

    function applyChosenActivity(lifeType) {
        const saved = savePlannerPrefs({ lifeType });
        syncLifeTypeUI(saved.lifeType);
        syncGoalUI(saved.goal);
        tryApplySavedNorm();
        closeLifestyleModal();
    }

    function applyChosenGoal(goal) {
        const saved = savePlannerPrefs({ goal });
        syncGoalUI(saved.goal);
        if (saved.lifeType) {
            tryApplySavedNorm();
        }
    }

    syncLifeTypeUI(selectedLifeType);
    syncGoalUI(loadPlannerPrefs().goal);

    document.addEventListener("click", (e) => {
        if (e.target.closest("#calc-norm-btn")) {
            e.preventDefault();
            loadProfileForNorm().then(() => {
                tryApplySavedNorm();
                openLifestyleModal();
            });
            return;
        }

        const goalBtn = e.target.closest(".goal-option");
        if (goalBtn && lifestyleModal && lifestyleModal.classList.contains("is-open")) {
            e.preventDefault();
            applyChosenGoal(goalBtn.dataset.goal);
            return;
        }

        const optionBtn = e.target.closest(".lifestyle-option");
        if (optionBtn && lifestyleModal && lifestyleModal.classList.contains("is-open")) {
            e.preventDefault();
            applyChosenActivity(optionBtn.dataset.lifeType);
            return;
        }

        if (e.target.closest("#close-lifestyle-modal") || e.target === lifestyleModal) {
            closeLifestyleModal();
        }
    });

    loadProfileForNorm().then(() => {
        tryApplySavedNorm();
    });

    const nutritionCalc = new DayNutritionCalculator();
    const daysListEl = document.getElementById("days-list");
    const addDayBtn = document.getElementById("add-day-btn");
    const clearWeekBtn = document.getElementById("clear-week-btn");
    const shoppingListBtn = document.getElementById("shopping-list-btn");

    if (!daysListEl) return;

    document.addEventListener("pointerdown", (e) => {
        document.querySelectorAll(".add-recipe-block").forEach((searchBlock) => {
            if (searchBlock.contains(e.target)) return;
            const openResults = searchBlock.querySelector(".recipe-search-results");
            if (openResults && !openResults.hidden) {
                openResults.hidden = true;
                openResults.innerHTML = "";
            }
        });
    });

    function makeDayItem(weekday = "", open = true, recipes = []) {
        return {
            id: `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            weekday,
            open,
            recipes: (Array.isArray(recipes) ? recipes : []).map(normalizePlannedRecipe).filter(Boolean)
        };
    }

    function loadDaysFromCache() {
        try {
            const raw = localStorage.getItem(SCHEDULER_STORAGE_KEY);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map((d) => ({
                        id: d?.id || `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        weekday: typeof d?.weekday === "string" ? d.weekday : "",
                        open: Boolean(d?.open),
                        recipes: (Array.isArray(d?.recipes) ? d.recipes : []).map(normalizePlannedRecipe).filter(Boolean)
                    }));
                }
            }
        } catch (err) {
            console.warn("[scheduler.js] Ошибка чтения кэша планировщика:", err);
        }
        const initial = [makeDayItem("", true, [])];
        saveDaysToCache(initial);
        return initial;
    }

    function saveDaysToCache(currentDays) {
        try {
            localStorage.setItem(SCHEDULER_STORAGE_KEY, JSON.stringify(currentDays));
        } catch (err) {
            console.warn("[scheduler.js] Ошибка записи в кэш планировщика:", err);
        }
    }

    let days = loadDaysFromCache();

    function getDayHeading(index, weekday) {
        const clean = String(weekday || "").trim();
        return clean || `День ${index + 1}`;
    }

    function updateDayKbju(dayCardEl, dayData) {
        const kbjuEl = dayCardEl?.querySelector(".day-kbju");
        if (kbjuEl) {
            kbjuEl.textContent = nutritionCalc.formatSummary(dayData.recipes);
        }
    }

    function refreshDayIndicesAndTitles() {
        const cards = daysListEl.querySelectorAll(".day-card");
        cards.forEach((card, index) => {
            const dayData = days[index];
            if (!dayData) return;
            card.dataset.dayId = dayData.id;

            if (!card.classList.contains("is-renaming")) {
                const titleEl = card.querySelector(".day-title");
                if (titleEl) {
                    titleEl.textContent = getDayHeading(index, dayData.weekday);
                }
            }
            updateDayKbju(card, dayData);
        });
    }

    function buildMealRow(dayData, recipe, dayCardEl) {
        const row = document.createElement("div");
        row.className = "meal-row";
        if (recipe.recipe_id != null) {
            row.dataset.recipeId = String(recipe.recipe_id);
        }

        const info = document.createElement("div");
        info.className = "meal-info";

        const titleSpan = document.createElement("span");
        titleSpan.className = "meal-title";
        titleSpan.textContent = recipe.title || "Блюдо";

        const kbjuSpan = document.createElement("span");
        kbjuSpan.className = "meal-kbju";
        kbjuSpan.textContent = nutritionCalc.formatMeal(recipe);

        info.appendChild(titleSpan);
        info.appendChild(kbjuSpan);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "remove-meal-btn";
        removeBtn.title = "Удалить блюдо";
        removeBtn.setAttribute("aria-label", "Удалить блюдо");
        removeBtn.textContent = "×";

        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            row.classList.add("is-removing");
            setTimeout(() => {
                dayData.recipes = (dayData.recipes || []).filter((r) => r !== recipe);
                saveDaysToCache(days);
                row.remove();
                updateDayKbju(dayCardEl, dayData);
            }, 220);
        });

        const weightWrap = document.createElement("label");
        weightWrap.className = "meal-weight-wrap";
        const weightInput = document.createElement("input");
        weightInput.type = "number";
        weightInput.className = "meal-weight-input";
        weightInput.min = "1";
        weightInput.step = "1";
        weightInput.value = String(recipe.weight);
        weightInput.setAttribute("aria-label", "Вес порции в граммах");
        const unit = document.createElement("span");
        unit.className = "meal-weight-unit";
        unit.textContent = "г";
        weightWrap.appendChild(weightInput);
        weightWrap.appendChild(unit);

        const applyWeight = () => {
            const next = Math.max(1, Math.round(Number(weightInput.value) || 0));
            recipe.weight = next;
            weightInput.value = String(next);
            kbjuSpan.textContent = nutritionCalc.formatMeal(recipe);
            updateDayKbju(dayCardEl, dayData);
            saveDaysToCache(days);
        };

        weightWrap.addEventListener("click", (e) => e.stopPropagation());
        weightInput.addEventListener("click", (e) => e.stopPropagation());
        weightInput.addEventListener("input", () => {
            const next = Number(weightInput.value);
            if (!(next > 0)) return;
            recipe.weight = next;
            kbjuSpan.textContent = nutritionCalc.formatMeal(recipe);
            updateDayKbju(dayCardEl, dayData);
            saveDaysToCache(days);
        });
        weightInput.addEventListener("change", applyWeight);
        weightInput.addEventListener("blur", applyWeight);

        row.appendChild(info);
        row.appendChild(weightWrap);
        row.appendChild(removeBtn);

        const openThisRecipe = (e) => {
            if (e.target.closest(".remove-meal-btn, .meal-weight-wrap, .meal-weight-input")) return;
            e.preventDefault();
            openPlannerRecipeCard(recipe);
        };
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.addEventListener("click", openThisRecipe);
        row.addEventListener("keydown", (e) => {
            if (e.target.closest(".meal-weight-input")) return;
            if (e.key === "Enter" || e.key === " ") {
                openThisRecipe(e);
            }
        });
        return row;
    }

    function startDayRename(card, titleEl, titleInput, dayData) {
        const currentIndex = days.findIndex((d) => d.id === dayData.id);
        const visible = getDayHeading(currentIndex === -1 ? 0 : currentIndex, dayData.weekday);
        titleInput.value = String(dayData.weekday || "").trim() || visible;
        card.classList.add("is-renaming");
        titleEl.hidden = true;
        titleInput.hidden = false;
        titleInput.focus();
        titleInput.select();
    }

    function finishDayRename(card, titleEl, titleInput, dayData, save) {
        if (!card.classList.contains("is-renaming")) return;
        if (save) {
            dayData.weekday = titleInput.value.trim();
            saveDaysToCache(days);
        }
        card.classList.remove("is-renaming");
        titleInput.hidden = true;
        titleEl.hidden = false;
        const currentIndex = days.findIndex((d) => d.id === dayData.id);
        titleEl.textContent = getDayHeading(currentIndex === -1 ? 0 : currentIndex, dayData.weekday);
    }

    function isLoggedInForSearch() {
        return Boolean(window.AuthAPI && typeof window.AuthAPI.isAuthenticated === "function" && window.AuthAPI.isAuthenticated());
    }

    function buildAddRecipeBlock(dayData, dayCardEl, mealsContainer) {
        const block = document.createElement("div");
        block.className = "add-recipe-block";

        const input = document.createElement("input");
        input.type = "search";
        input.className = "recipe-search-input";
        input.placeholder = "Найти рецепт в избранном";
        input.setAttribute("aria-label", "Поиск рецепта в избранном");
        input.autocomplete = "off";

        const status = document.createElement("p");
        status.className = "recipe-search-status";
        status.hidden = true;

        const results = document.createElement("div");
        results.className = "recipe-search-results";
        results.hidden = true;
        results.setAttribute("role", "listbox");

        block.appendChild(input);
        block.appendChild(status);
        block.appendChild(results);

        const showStatus = (html) => {
            status.hidden = !html;
            status.innerHTML = html || "";
        };
        const hideResults = () => {
            results.hidden = true;
            results.innerHTML = "";
        };

        if (!isLoggedInForSearch()) {
            input.disabled = true;
            showStatus(`Чтобы искать рецепты, <a href="../vxod/index.html">войдите в аккаунт</a> — поиск идёт по избранному.`);
            input.addEventListener("click", (e) => e.stopPropagation());
            return block;
        }

        let debounceId = null;
        let requestSeq = 0;

        const addRecipeToDay = (recipe) => {
            if (!recipe) return;
            const already = (dayData.recipes || []).some((r) => r.recipe_id != null && r.recipe_id === recipe.recipe_id);
            if (already) {
                showStatus("Этот рецепт уже добавлен в день.");
                hideResults();
                return;
            }
            dayData.recipes.push(recipe);
            saveDaysToCache(days);
            const meals = mealsContainer.querySelectorAll(".meal-row");
            const lastMeal = meals[meals.length - 1];
            const row = buildMealRow(dayData, recipe, dayCardEl);
            if (lastMeal) {
                lastMeal.after(row);
            } else {
                mealsContainer.prepend(row);
            }
            updateDayKbju(dayCardEl, dayData);
            input.value = "";
            hideResults();
            showStatus("");
        };

        const renderResults = (items) => {
            results.innerHTML = "";
            if (!items.length) {
                hideResults();
                showStatus("Ничего не найдено в избранном.");
                return;
            }
            showStatus("");
            items.forEach((item) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "recipe-search-item";
                btn.setAttribute("role", "option");
                const portionKcal = Math.round(portionOf(item).calories);
                const name = document.createElement("span");
                name.textContent = item.title;
                const kcal = document.createElement("span");
                kcal.className = "recipe-search-item-kcal";
                kcal.textContent = ` · ${portionKcal} ккал`;
                btn.appendChild(name);
                btn.appendChild(kcal);
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    addRecipeToDay(item);
                });
                results.appendChild(btn);
            });
            results.hidden = false;
        };

        let lastRenderedQuery = null;

        const showCachedOrExisting = (key) => {
            if (lastRenderedQuery === key && !results.hidden) return true;
            if (searchQueryCache.has(key)) {
                lastRenderedQuery = key;
                renderResults(searchQueryCache.get(key));
                return true;
            }
            if (lastRenderedQuery === key && results.childElementCount) {
                results.hidden = false;
                showStatus("");
                return true;
            }
            return false;
        };

        const runSearch = async (query) => {
            const key = searchKey(query);
            if (showCachedOrExisting(key)) return;
            const seq = ++requestSeq;
            // Не чистим уже открытый список — оставляем его, пока не придут новые результаты.
            if (results.hidden || !results.childElementCount) {
                showStatus("Ищем…");
            }
            try {
                const data = await window.AuthAPI.searchFavoriteRecipes(query);
                if (seq !== requestSeq) return;
                const ids = Array.isArray(data?.recipes) ? data.recipes : [];
                if (!ids.length) {
                    searchQueryCache.set(key, []);
                    lastRenderedQuery = key;
                    renderResults([]);
                    return;
                }
                const details = await mapPool(ids, RECIPE_FETCH_CONCURRENCY, (id) => getRecipeDetailsCached(id));
                if (seq !== requestSeq) return;
                const items = details.map(recipeFromApi).filter(Boolean);
                searchQueryCache.set(key, items);
                lastRenderedQuery = key;
                renderResults(items);
            } catch (err) {
                if (seq !== requestSeq) return;
                if (results.hidden || !results.childElementCount) {
                    hideResults();
                }
                if (err && err.status === 401) {
                    input.disabled = true;
                    showStatus(`Сессия истекла. <a href="../vxod/index.html">Войдите снова</a>, чтобы искать в избранном.`);
                    return;
                }
                showStatus("Не удалось выполнить поиск. Попробуйте ещё раз.");
            }
        };

        const scheduleSearch = () => {
            clearTimeout(debounceId);
            debounceId = setTimeout(() => {
                runSearch(input.value);
            }, SEARCH_DEBOUNCE_MS);
        };

        const openSearchIfNeeded = () => {
            const key = searchKey(input.value);
            if (lastRenderedQuery === key && !results.hidden) return;
            if (showCachedOrExisting(key)) return;
            if (input.value.trim()) scheduleSearch();
            else runSearch(input.value);
        };
        input.addEventListener("click", (e) => {
            e.stopPropagation();
            // Клик по уже сфокусированному полю (после закрытия снаружи) не даёт focus,
            // поэтому открываем список и отсюда — без повторного запроса, если кэш есть.
            openSearchIfNeeded();
        });
        input.addEventListener("focus", openSearchIfNeeded);
        input.addEventListener("input", scheduleSearch);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                hideResults();
                input.blur();
            }
        });

        return block;
    }

    function setDayOpen(card, mealsContainer, open, animate) {
        card.classList.toggle("open", open);
        if (!mealsContainer) return;
        if (open) {
            if (!animate) {
                mealsContainer.style.maxHeight = "none";
                mealsContainer.style.overflow = "visible";
                return;
            }
            mealsContainer.style.overflow = "hidden";
            mealsContainer.style.maxHeight = mealsContainer.scrollHeight + "px";
            const onEnd = (event) => {
                if (event.propertyName !== "max-height") return;
                mealsContainer.removeEventListener("transitionend", onEnd);
                if (card.classList.contains("open")) {
                    mealsContainer.style.maxHeight = "none";
                    mealsContainer.style.overflow = "visible";
                }
            };
            mealsContainer.addEventListener("transitionend", onEnd);
            return;
        }
        mealsContainer.style.overflow = "hidden";
        mealsContainer.style.maxHeight = mealsContainer.scrollHeight + "px";
        mealsContainer.getBoundingClientRect();
        mealsContainer.style.maxHeight = "0px";
    }

    function buildDayElement(dayData, index, animateEnter = false) {

        const card = document.createElement("div");
        card.className = `day-card${dayData.open ? " open" : ""}${animateEnter ? " is-entering" : ""}`;
        card.dataset.dayId = dayData.id;

        const headerRow = document.createElement("div");
        headerRow.className = "day-header-row";

        const titleGroup = document.createElement("div");
        titleGroup.className = "day-title-group";

        const titleRow = document.createElement("div");
        titleRow.className = "day-title-row";

        const titleEl = document.createElement("div");
        titleEl.className = "day-title";
        titleEl.textContent = getDayHeading(index, dayData.weekday);

        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.className = "day-title-input";
        titleInput.hidden = true;
        titleInput.maxLength = 40;
        titleInput.setAttribute("aria-label", "Название дня");

        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "rename-day-btn";
        renameBtn.title = "Переименовать день";
        renameBtn.setAttribute("aria-label", "Переименовать день");
        renameBtn.innerHTML = PENCIL_ICON;

        titleRow.appendChild(titleEl);
        titleRow.appendChild(titleInput);
        titleRow.appendChild(renameBtn);

        const kbjuEl = document.createElement("div");
        kbjuEl.className = "day-kbju";
        kbjuEl.textContent = nutritionCalc.formatSummary(dayData.recipes);

        titleGroup.appendChild(titleRow);
        titleGroup.appendChild(kbjuEl);

        const controlsEl = document.createElement("div");
        controlsEl.className = "day-controls";

        const removeDayBtn = document.createElement("button");
        removeDayBtn.type = "button";
        removeDayBtn.className = "remove-day-btn";
        removeDayBtn.title = "Удалить день";
        removeDayBtn.setAttribute("aria-label", "Удалить день");
        removeDayBtn.textContent = "×";

        removeDayBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeDayWithAnimation(dayData.id, card);
        });

        controlsEl.appendChild(removeDayBtn);
        headerRow.appendChild(titleGroup);
        headerRow.appendChild(controlsEl);

        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            startDayRename(card, titleEl, titleInput, dayData);
        });
        titleEl.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            startDayRename(card, titleEl, titleInput, dayData);
        });
        titleInput.addEventListener("click", (e) => e.stopPropagation());
        titleInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                finishDayRename(card, titleEl, titleInput, dayData, true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finishDayRename(card, titleEl, titleInput, dayData, false);
            }
        });
        titleInput.addEventListener("blur", () => {
            finishDayRename(card, titleEl, titleInput, dayData, true);
        });

        headerRow.addEventListener("click", (e) => {
            if (e.target.closest(".rename-day-btn, .day-title-input, .remove-day-btn")) return;
            if (card.classList.contains("is-renaming")) return;
            dayData.open = !dayData.open;
            setDayOpen(card, mealsContainer, dayData.open, true);
            saveDaysToCache(days);
        });

        const mealsContainer = document.createElement("div");
        mealsContainer.className = "day-meals";

        (dayData.recipes || []).forEach((recipe) => {
            mealsContainer.appendChild(buildMealRow(dayData, recipe, card));
        });
        mealsContainer.appendChild(buildAddRecipeBlock(dayData, card, mealsContainer));

        card.appendChild(headerRow);
        card.appendChild(mealsContainer);

        if (dayData.open) {
            setDayOpen(card, mealsContainer, true, false);
        }

        if (animateEnter) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    card.classList.remove("is-entering");
                });
            });
        }

        return { card };
    }

    function removeDayWithAnimation(dayId, cardEl) {
        if (!cardEl || cardEl.classList.contains("is-leaving")) return;
        cardEl.classList.add("is-leaving");

        setTimeout(() => {
            days = days.filter((d) => d.id !== dayId);
            saveDaysToCache(days);
            cardEl.remove();
            refreshDayIndicesAndTitles();
        }, 250);
    }

    function renderAllDays() {
        daysListEl.innerHTML = "";
        days.forEach((dayData, idx) => {
            const { card } = buildDayElement(dayData, idx, false);
            daysListEl.appendChild(card);
        });
    }

    addDayBtn?.addEventListener("click", () => {
        const nextIndex = days.length;
        const newDay = makeDayItem("", true, []);
        days.push(newDay);
        saveDaysToCache(days);

        const { card } = buildDayElement(newDay, nextIndex, true);
        daysListEl.appendChild(card);
        refreshDayIndicesAndTitles();
    });

    clearWeekBtn?.addEventListener("click", () => {
        days = [];
        saveDaysToCache(days);
        daysListEl.innerHTML = "";
    });

    const plannerRecipeModal = document.getElementById("planner-recipe-modal");
    const plannerRecipeCard = document.getElementById("planner-recipe-card");
    const plannerRecipeError = document.getElementById("planner-recipe-error");
    let plannerRecipeOpenSeq = 0;

    function applyPlannerRecipeOverlayOpen() {
        if (!plannerRecipeModal) return;
        plannerRecipeModal.classList.add("is-open");
        plannerRecipeModal.setAttribute("aria-hidden", "false");
        plannerRecipeModal.style.cssText = [
            "position: fixed",
            "inset: 0",
            "width: 100vw",
            "height: 100vh",
            "background-color: rgba(0, 0, 0, 0.5)",
            "display: flex",
            "align-items: flex-start",
            "justify-content: center",
            "padding: 20px 12px 32px",
            "overflow-y: auto",
            "z-index: 100050"
        ].join(" !important; ") + " !important;";
        lockPageScroll();
    }

    function peekRecipeDetails(id) {
        if (!recipeDetailsCache.has(id)) return null;
        const value = recipeDetailsCache.get(id);
        if (!value || typeof value.then === "function") return null;
        return value;
    }

    function isImageCached(url) {
        const src = String(url || "").trim();
        if (!src) return true;
        const img = new Image();
        img.src = src;
        return Boolean(img.complete && img.naturalWidth > 0);
    }

    function preloadRecipeImage(url) {
        const src = String(url || "").trim();
        if (!src) return Promise.resolve("");
        return new Promise((resolve) => {
            let settled = false;
            const done = (ok) => {
                if (settled) return;
                settled = true;
                resolve(ok ? src : "");
            };
            const img = new Image();
            img.onload = () => done(img.naturalWidth > 0);
            img.onerror = () => done(false);
            img.src = src;
            if (img.complete) done(img.naturalWidth > 0);
        });
    }

    function resetPlannerRecipeCard() {
        if (!plannerRecipeCard) return;
        const img = plannerRecipeCard.querySelector("#recipe-image");
        if (img) {
            img.onload = null;
            img.onerror = null;
            img.removeAttribute("src");
            img.src = "";
            img.alt = "";
            img.style.display = "";
        }
        [
            "recipe-title", "recipe-description", "recipe-calories",
            "recipe-time", "recipe-weight", "recipe-belki",
            "recipe-fats", "recipe-uglevods", "recipe-hyper-text"
        ].forEach((id) => {
            const el = plannerRecipeCard.querySelector("#" + id);
            if (el) el.textContent = "";
        });
        ["recipe-stars", "recipe-equipment", "recipe-ingredients"].forEach((id) => {
            const el = plannerRecipeCard.querySelector("#" + id);
            if (el) el.innerHTML = "";
        });
    }

    function setPlannerRecipeLoading(isLoading) {
        if (!plannerRecipeCard) return;
        plannerRecipeCard.classList.toggle("is-loading", isLoading);
        plannerRecipeCard.setAttribute("aria-busy", isLoading ? "true" : "false");
        const loader = document.getElementById("planner-recipe-loading");
        if (loader) loader.hidden = !isLoading;
    }

    function closePlannerRecipeCard() {
        if (!plannerRecipeModal) return;
        plannerRecipeOpenSeq += 1;
        plannerRecipeModal.classList.remove("is-open");
        plannerRecipeModal.setAttribute("aria-hidden", "true");
        plannerRecipeModal.style.cssText = "display: none !important;";
        setPlannerRecipeLoading(false);
        resetPlannerRecipeCard();
        if (plannerRecipeError) {
            plannerRecipeError.hidden = true;
            plannerRecipeError.textContent = "";
        }
        unlockPageScroll();
    }

    async function fillPlannerRecipeCard(data, seq, skipImage) {
        if (seq !== plannerRecipeOpenSeq) return false;
        if (!window.RecipeCard || typeof window.RecipeCard.fill !== "function") {
            throw new Error("RecipeCard missing");
        }
        await window.RecipeCard.fill(plannerRecipeCard, data, {
            starSrc: "../swipe_recipe/star-10.svg",
            loadHyperText: true,
            skipImage: Boolean(skipImage),
            isStale: () => seq !== plannerRecipeOpenSeq
        });
        return seq === plannerRecipeOpenSeq;
    }

    async function openPlannerRecipeCard(recipe) {
        const recipeId = recipe && (recipe.recipe_id != null ? recipe.recipe_id : recipe.id);
        if (recipeId == null || !plannerRecipeModal || !plannerRecipeCard) return;
        const seq = ++plannerRecipeOpenSeq;
        if (plannerRecipeError) {
            plannerRecipeError.hidden = true;
            plannerRecipeError.textContent = "";
        }
        resetPlannerRecipeCard();
        setPlannerRecipeLoading(true);
        applyPlannerRecipeOverlayOpen();

        try {
            const hasFullData = Array.isArray(recipe.ingredients);
            const cached = peekRecipeDetails(recipeId) || (hasFullData ? recipe : null);
            const imageReady = cached ? isImageCached(cached.image_url) : false;
            let data = cached;
            if (!data) {
                data = await getRecipeDetailsCached(recipeId);
            }
            if (seq !== plannerRecipeOpenSeq) return;
            if (!data) throw new Error("empty");

            let skipImage = !data.image_url;
            if (data.image_url && !imageReady) {
                const loadedUrl = await preloadRecipeImage(data.image_url);
                if (seq !== plannerRecipeOpenSeq) return;
                skipImage = !loadedUrl;
            } else if (seq !== plannerRecipeOpenSeq) {
                return;
            }

            const filled = await fillPlannerRecipeCard(data, seq, skipImage);
            if (!filled) return;
            setPlannerRecipeLoading(false);
        } catch (_) {
            if (seq !== plannerRecipeOpenSeq) return;
            setPlannerRecipeLoading(false);
            if (plannerRecipeError) {
                plannerRecipeError.hidden = false;
                plannerRecipeError.textContent = "Не удалось загрузить карточку рецепта.";
            }
        }
    }

    plannerRecipeModal?.addEventListener("click", (e) => {
        if (e.target === plannerRecipeModal || e.target.closest("#planner-recipe-back-btn")) {
            closePlannerRecipeCard();
        }
    });

    const shoppingModal = document.getElementById("shopping-modal");
    const shoppingBody = document.getElementById("shopping-list-body");
    const shoppingActions = document.getElementById("shopping-list-actions");
    const shoppingShareBtn = document.getElementById("shopping-share-btn");
    const shoppingCopyBtn = document.getElementById("shopping-copy-btn");
    let shoppingItems = [];
    let shoppingCopyTimer = null;

    function applyShoppingOverlayOpen() {
        if (!shoppingModal) return;
        shoppingModal.classList.add("is-open");
        shoppingModal.setAttribute("aria-hidden", "false");
        shoppingModal.style.cssText = [
            "position: fixed",
            "inset: 0",
            "width: 100vw",
            "height: 100vh",
            "background-color: rgba(0, 0, 0, 0.5)",
            "display: flex",
            "align-items: center",
            "justify-content: center",
            "padding: 20px",
            "z-index: 99999"
        ].join(" !important; ") + " !important;";
        const card = shoppingModal.querySelector(".shopping-modal");
        if (card) {
            card.style.cssText = [
                "background-color: #ffffff",
                "border-radius: 12px",
                "padding: 16px",
                "width: 100%",
                "max-width: 352px",
                "max-height: min(88vh, 640px)",
                "display: flex",
                "flex-direction: column",
                "gap: 12px",
                "box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25)",
                "position: relative",
                "z-index: 100000"
            ].join(" !important; ") + " !important;";
        }
        lockPageScroll();
    }

    function closeShoppingModal() {
        if (!shoppingModal) return;
        shoppingModal.classList.remove("is-open");
        shoppingModal.setAttribute("aria-hidden", "true");
        shoppingModal.style.cssText = "display: none !important;";
        if (shoppingCopyBtn) shoppingCopyBtn.textContent = "Скопировать";
        if (shoppingCopyTimer) {
            clearTimeout(shoppingCopyTimer);
            shoppingCopyTimer = null;
        }
        unlockPageScroll();
    }

    function shoppingListText() {
        return shoppingItems.map(formatShoppingLine).join("\n");
    }

    function renderShoppingItems(items) {
        shoppingItems = items || [];
        if (!shoppingBody) return;
        shoppingBody.innerHTML = "";
        if (!shoppingItems.length) {
            const empty = document.createElement("p");
            empty.className = "shopping-empty";
            empty.textContent = "В плане пока нет рецептов.";
            shoppingBody.appendChild(empty);
            if (shoppingActions) shoppingActions.hidden = true;
            return;
        }
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
            amount.textContent = item.qualitative || !Number.isFinite(item.amount)
                ? "по вкусу"
                : [formatAmount(item.amount), unitLabel(item.unit)].filter(Boolean).join(" ");
            label.appendChild(box);
            label.appendChild(name);
            label.appendChild(amount);
            shoppingBody.appendChild(label);
        });
        saveShoppingChecked(kept);
        if (shoppingActions) shoppingActions.hidden = false;
    }

    async function openShoppingModal() {
        if (!shoppingModal || !shoppingBody) return;
        applyShoppingOverlayOpen();
        shoppingBody.innerHTML = "";
        const status = document.createElement("p");
        status.className = "shopping-status";
        status.textContent = "Собираем список…";
        shoppingBody.appendChild(status);
        if (shoppingActions) shoppingActions.hidden = true;

        const planned = [];
        (days || []).forEach((day) => {
            (day.recipes || []).forEach((recipe) => {
                const norm = normalizePlannedRecipe(recipe);
                if (norm && norm.recipe_id != null) planned.push(norm);
            });
        });
        if (!planned.length) {
            renderShoppingItems([]);
            return;
        }
        if (!window.AuthAPI || typeof window.AuthAPI.getRecipeById !== "function") {
            shoppingBody.innerHTML = "";
            const err = document.createElement("p");
            err.className = "shopping-status";
            err.textContent = "Не удалось загрузить ингредиенты.";
            shoppingBody.appendChild(err);
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
            renderShoppingItems(aggregateShoppingItems(entries));
        } catch (_) {
            shoppingBody.innerHTML = "";
            const err = document.createElement("p");
            err.className = "shopping-status";
            err.textContent = "Не удалось загрузить ингредиенты.";
            shoppingBody.appendChild(err);
        }
    }

    async function copyShoppingList() {
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
        if (copied && shoppingCopyBtn) {
            shoppingCopyBtn.textContent = "Скопировано";
            if (shoppingCopyTimer) clearTimeout(shoppingCopyTimer);
            shoppingCopyTimer = setTimeout(() => {
                shoppingCopyBtn.textContent = "Скопировать";
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

    shoppingListBtn?.addEventListener("click", () => {
        openShoppingModal();
    });
    shoppingShareBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        shareShoppingList();
    });
    shoppingCopyBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        copyShoppingList();
    });
    shoppingModal?.addEventListener("click", (e) => {
        if (e.target === shoppingModal || e.target.closest("#close-shopping-modal")) {
            closeShoppingModal();
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const recipeModal = document.getElementById("planner-recipe-modal");
        if (recipeModal && recipeModal.classList.contains("is-open")) {
            e.preventDefault();
            closePlannerRecipeCard();
            return;
        }
        if (shoppingModal && shoppingModal.classList.contains("is-open")) {
            e.preventDefault();
            closeShoppingModal();
        }
    });

    renderAllDays();
});
