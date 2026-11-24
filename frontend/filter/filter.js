/**
- ДЛЯ ЧЕГО: Оживляет тумблеры, подгружает сохраненные фильтры при старте страницы
- и отправляет актуальные списки настроек обратно на бэк по контракту PATCH /api/db/me/preferences
- (или сохраняет в кеш, если пользователь не авторизован).
 */

document.addEventListener("DOMContentLoaded", async () => {
    const toggles = document.querySelectorAll(".div11");
    const isAuth = Boolean(window.AuthAPI && typeof window.AuthAPI.isAuthenticated === "function" && window.AuthAPI.isAuthenticated());

    function applyPreferencesToToggles(prefsData) {
        if (!prefsData) return;

        toggles.forEach(toggle => {
            const type = toggle.getAttribute("data-type"); // allergy, diet, religion, equipment
            const id = toggle.getAttribute("data-id");     // nuts, fish, halal и т.д.

            let shouldBeActive = false;

            if (type === "allergy" && prefsData.allergies?.includes(id)) {
                shouldBeActive = true;
            } else if (type === "diet" && prefsData.diets?.includes(id)) {
                shouldBeActive = true;
            } else if (type === "religion" && prefsData.religions?.includes(id)) {
                shouldBeActive = true;
            } else if (type === "equipment" && prefsData.kitchen_equipment?.includes(id)) {
                shouldBeActive = true;
            }

            if (shouldBeActive) {
                toggle.classList.add("active");
            } else {
                toggle.classList.remove("active");
            }
        });
    }

    // 1. Анимация ручного переключения тумблеров по клику
    toggles.forEach(toggle => {
        toggle.addEventListener("click", () => {
            toggle.classList.toggle("active");
        });
    });

    // 2. ДИНАМИЧЕСКАЯ ПОДГРУЗКА: Запрашиваем фильтры с сервера или читаем кеш гостя
    try {
        if (!isAuth && typeof window.AuthAPI.getCachedEquipment === "function") {
            const guestData = await window.AuthAPI.getCachedEquipment();
            applyPreferencesToToggles(guestData);
            console.log("[filter.js] Загружены гостевые настройки из кеша:", guestData);
        } else {
            console.log("[filter.js] Запрашиваем сохраненные настройки у сервера...");
            const savedData = await window.AuthAPI.getPreferences();
            console.log("[filter.js] Данные успешно получены с бэка:", savedData);
            applyPreferencesToToggles(savedData);
            console.log("[filter.js] Все сохраненные тумблеры успешно активированы на экране!");
        }
    } catch (loadError) {
        console.warn("[filter.js] Не удалось загрузить настройки (возможно, это первый вход гостя):", loadError.message);
    }

    // 3. Сбор всех активных значений и отправка на бэкенд / сохранение в кеш по клику на "Сохранить"
    const saveBtn = document.querySelector(".frame-40");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const payload = {
                allergies: [],
                diets: [],
                religions: [],
                kitchen_equipment: []
            };

            toggles.forEach(toggle => {
                if (!toggle.classList.contains("active")) return;

                const type = toggle.getAttribute("data-type");
                const id = toggle.getAttribute("data-id");
                if (!id) return;

                if (type === "allergy" && !payload.allergies.includes(id)) payload.allergies.push(id);
                else if (type === "diet" && !payload.diets.includes(id)) payload.diets.push(id);
                else if (type === "religion" && !payload.religions.includes(id)) payload.religions.push(id);
                else if (type === "equipment" && !payload.kitchen_equipment.includes(id)) payload.kitchen_equipment.push(id);
            });

            console.log("===> [filter.js] Отправляем актуальные настройки (PATCH /api/db/me/preferences):", payload);

            try {
                const response = await window.AuthAPI.updatePreferences(payload);
                if (response.code === 200 || response.state === "OK" || String(response.state || "").startsWith("OK")) {
                    alert("✨ Изменения успешно сохранены! Профиль обновлен. ✨");
                }
            } catch (error) {
                alert(`Ошибка сохранения: ${error.message}`);
            }
        });
    }
});