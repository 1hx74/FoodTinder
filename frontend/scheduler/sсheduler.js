/**
- ДЛЯ ЧЕГО: Контроллер страницы планировщика питания (работает только с локальным кэшем localStorage).
- Управляет добавлением/удалением дней с авто-пересчётом номеров,
- ручным вводом дня недели справа, удалением блюд внутри дня,
- выбором образа жизни (life_type: 1..4) в локальном кэше
- и заготовкой расчёта КБЖУ за день.
 */

const SCHEDULER_STORAGE_KEY = "foodtinder_scheduler_days_v1";
const LIFESTYLE_CACHE_KEY = "foodtinder_user_lifestyle_v1";

function loadCachedLifeType() {
    try {
        const raw = localStorage.getItem(LIFESTYLE_CACHE_KEY);
        if (!raw) return 1;
        const parsed = JSON.parse(raw);
        const value = Number(typeof parsed === "object" && parsed !== null ? parsed.life_type : parsed);
        return [1, 2, 3, 4].includes(value) ? value : 1;
    } catch (_) {
        return 1;
    }
}

function saveCachedLifeType(lifeType) {
    const normalized = [1, 2, 3, 4].includes(Number(lifeType)) ? Number(lifeType) : 1;
    try {
        localStorage.setItem(LIFESTYLE_CACHE_KEY, JSON.stringify({ life_type: normalized }));
    } catch (_) {}
    return normalized;
}

class DayNutritionCalculator {
    calculate(recipes = []) {
        return recipes.reduce(
            (acc, item) => {
                acc.calories += Number(item.calories ?? item.kalories ?? 0) || 0;
                acc.protein += Number(item.protein ?? item.belki ?? 0) || 0;
                acc.fat += Number(item.fat ?? item.fats ?? 0) || 0;
                acc.carbs += Number(item.carbs ?? item.uglevods ?? 0) || 0;
                return acc;
            },
            { calories: 0, protein: 0, fat: 0, carbs: 0 }
        );
    }

    formatSummary(recipes = []) {
        const totals = this.calculate(recipes);
        return `КБЖУ: ${Math.round(totals.calories)} ккал · Б ${Math.round(totals.protein)} · Ж ${Math.round(totals.fat)} · У ${Math.round(totals.carbs)}`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Модалка образа жизни (life_type: 1..4) — вынесена в начало, чтобы работала независимо от остального кода
    const lifestyleModal = document.getElementById("lifestyle-modal");
    const lifeTypeOptions = Array.from(document.querySelectorAll(".lifestyle-option"));
    let selectedLifeType = loadCachedLifeType();

    function syncLifeTypeUI(lifeType) {
        const normalized = [1, 2, 3, 4].includes(Number(lifeType)) ? Number(lifeType) : 1;
        selectedLifeType = normalized;
        lifeTypeOptions.forEach((btn) => {
            const isSelected = Number(btn.dataset.lifeType) === normalized;
            btn.classList.toggle("is-selected", isSelected);
            btn.setAttribute("aria-checked", String(isSelected));
        });
    }

    function openLifestyleModal() {
        syncLifeTypeUI(loadCachedLifeType());
        const modal = document.getElementById("lifestyle-modal");
        if (!modal) {
            console.warn("[sheduler.js] #lifestyle-modal не найден в DOM");
            return;
        }
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
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
    }

    syncLifeTypeUI(selectedLifeType);

    document.addEventListener("click", (e) => {
        if (e.target.closest("#calc-norm-btn")) {
            e.preventDefault();
            openLifestyleModal();
            return;
        }

        const optionBtn = e.target.closest(".lifestyle-option");
        if (optionBtn) {
            const chosen = saveCachedLifeType(optionBtn.dataset.lifeType);
            syncLifeTypeUI(chosen);
            return;
        }

        if (e.target.closest("#save-lifestyle-btn")) {
            const saved = saveCachedLifeType(selectedLifeType);
            syncLifeTypeUI(saved);
            closeLifestyleModal();
            return;
        }

        if (e.target.closest("#close-lifestyle-modal") || e.target === lifestyleModal) {
            closeLifestyleModal();
        }
    });

    const nutritionCalc = new DayNutritionCalculator();
    const daysListEl = document.getElementById("days-list");
    const addDayBtn = document.getElementById("add-day-btn");
    const clearWeekBtn = document.getElementById("clear-week-btn");
    const shoppingListBtn = document.getElementById("shopping-list-btn");

    if (!daysListEl) return;

    function makeDayItem(weekday = "", open = true, recipes = []) {
        return {
            id: `day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            weekday,
            open,
            recipes: Array.isArray(recipes) ? recipes : []
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
                        recipes: Array.isArray(d?.recipes) ? d.recipes : []
                    }));
                }
            }
        } catch (err) {
            console.warn("[sheduler.js] Ошибка чтения кэша планировщика:", err);
        }
        const initial = [makeDayItem("", true, [])];
        saveDaysToCache(initial);
        return initial;
    }

    function saveDaysToCache(currentDays) {
        try {
            localStorage.setItem(SCHEDULER_STORAGE_KEY, JSON.stringify(currentDays));
        } catch (err) {
            console.warn("[sheduler.js] Ошибка записи в кэш планировщика:", err);
        }
    }

    let days = loadDaysFromCache();

    function getDayHeading(index, weekday) {
        const dayNumber = index + 1;
        const cleanWeekday = String(weekday || "").trim();
        return cleanWeekday ? `День ${dayNumber} - ${cleanWeekday}` : `День ${dayNumber}`;
    }

    function refreshDayIndicesAndTitles() {
        const cards = daysListEl.querySelectorAll(".day-card");
        cards.forEach((card, index) => {
            const dayData = days[index];
            if (!dayData) return;
            card.dataset.dayId = dayData.id;

            const titleEl = card.querySelector(".day-title");
            if (titleEl) {
                titleEl.textContent = getDayHeading(index, dayData.weekday);
            }

            const kbjuEl = card.querySelector(".day-kbju");
            if (kbjuEl) {
                kbjuEl.textContent = nutritionCalc.formatSummary(dayData.recipes);
            }
        });
    }

    function buildMealRow(dayData, recipe, dayCardEl) {
        const row = document.createElement("div");
        row.className = "meal-row";

        const titleSpan = document.createElement("span");
        titleSpan.className = "meal-title";
        titleSpan.textContent = recipe.title || recipe.name || "Блюдо";

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
                const kbjuEl = dayCardEl.querySelector(".day-kbju");
                if (kbjuEl) {
                    kbjuEl.textContent = nutritionCalc.formatSummary(dayData.recipes);
                }
            }, 220);
        });

        row.appendChild(titleSpan);
        row.appendChild(removeBtn);
        return row;
    }

    function buildDayElement(dayData, index, animateEnter = false) {
        const card = document.createElement("div");
        card.className = `day-card${dayData.open ? " open" : ""}${animateEnter ? " is-entering" : ""}`;
        card.dataset.dayId = dayData.id;

        const headerRow = document.createElement("div");
        headerRow.className = "day-header-row";

        const titleGroup = document.createElement("div");
        titleGroup.className = "day-title-group";

        const titleEl = document.createElement("div");
        titleEl.className = "day-title";
        titleEl.textContent = getDayHeading(index, dayData.weekday);

        const kbjuEl = document.createElement("div");
        kbjuEl.className = "day-kbju";
        kbjuEl.textContent = nutritionCalc.formatSummary(dayData.recipes);

        titleGroup.appendChild(titleEl);
        titleGroup.appendChild(kbjuEl);

        const controlsEl = document.createElement("div");
        controlsEl.className = "day-controls";

        const weekdayInput = document.createElement("input");
        weekdayInput.type = "text";
        weekdayInput.className = "weekday-input";
        weekdayInput.placeholder = "День недели";
        weekdayInput.value = dayData.weekday || "";
        weekdayInput.setAttribute("aria-label", "День недели");

        weekdayInput.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        weekdayInput.addEventListener("input", (e) => {
            dayData.weekday = e.target.value;
            const currentIndex = days.findIndex((d) => d.id === dayData.id);
            if (currentIndex !== -1 && titleEl) {
                titleEl.textContent = getDayHeading(currentIndex, dayData.weekday);
            }
            saveDaysToCache(days);
        });

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

        controlsEl.appendChild(weekdayInput);
        controlsEl.appendChild(removeDayBtn);
        headerRow.appendChild(titleGroup);
        headerRow.appendChild(controlsEl);

        headerRow.addEventListener("click", () => {
            dayData.open = !dayData.open;
            card.classList.toggle("open", dayData.open);
            saveDaysToCache(days);
        });

        const mealsContainer = document.createElement("div");
        mealsContainer.className = "day-meals";

        (dayData.recipes || []).forEach((recipe) => {
            mealsContainer.appendChild(buildMealRow(dayData, recipe, card));
        });

        card.appendChild(headerRow);
        card.appendChild(mealsContainer);

        if (animateEnter) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    card.classList.remove("is-entering");
                });
            });
        }

        return { card, weekdayInput };
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

        const { card, weekdayInput } = buildDayElement(newDay, nextIndex, true);
        daysListEl.appendChild(card);
        refreshDayIndicesAndTitles();
        weekdayInput?.focus();
    });

    clearWeekBtn?.addEventListener("click", () => {
        days = [];
        saveDaysToCache(days);
        daysListEl.innerHTML = "";
    });

    shoppingListBtn?.addEventListener("click", () => {
        console.log("[sheduler.js] Список покупок (из кэша):", days);
    });

    renderAllDays();
});