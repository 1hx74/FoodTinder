/**
 * ДЛЯ ЧЕГО: Оживляет тумблеры, подгружает сохраненные фильтры при старте страницы
 * и отправляет измененные JSON-данные обратно на бэк по контракту.
 */

document.addEventListener("DOMContentLoaded", async () => {
    const toggles = document.querySelectorAll(".div11");

    // 1. Анимация ручного переключения тумблеров по клику
    toggles.forEach(toggle => {
        toggle.addEventListener("click", () => {
            toggle.classList.toggle("active");
        });
    });

    // 2. ДИНАМИЧЕСКАЯ ПОДГРУЗКА: Запрашиваем фильтры из сессии при открытии страницы
    try {
        console.log("[profile.js] Запрашиваем сохраненные настройки у сервера...");
        const savedData = await window.AuthAPI.getPreferences();
        console.log("[profile.js] Данные успешно получены с бэка:", savedData);

        // Проверяем, что сервер вернул корректный JSON-объект
        if (savedData) {
            // Перебираем каждый тумблер на экране и смотрим, есть ли его ID в массивах с сервера
            toggles.forEach(toggle => {
                const type = toggle.getAttribute("data-type"); // allergy, diet, religion, equipment
                const id = toggle.getAttribute("data-id");     // nuts, fish, halal и т.д.

                // Если это аллергия или диета — ищем её в общем серверном массиве "forbidden"
                if ((type === "allergy" || type === "diet") && savedData.forbidden?.includes(id)) {
                    toggle.classList.add("active");
                }
                // Если вероисповедание — ищем в массиве "religions"
                else if (type === "religion" && savedData.religions?.includes(id)) {
                    toggle.classList.add("active");
                }
                // Если приборы — ищем в массиве "kitchen_equipment"
                else if (type === "equipment" && savedData.kitchen_equipment?.includes(id)) {
                    toggle.classList.add("active");
                }
            });
            console.log("[profile.js] Все сохраненные тумблеры успешно активированы на экране!");
        }
    } catch (loadError) {
        console.warn("[profile.js] Не удалось загрузить настройки (возможно, это первый вход гостя):", loadError.message);
    }

    // 3. Сбор данных экрана и отправка на бэкенд по клику на "Сохранить"
    const saveBtn = document.querySelector(".frame-40");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            // Формируем структуру строго под твой контракт PATCH/POST
            const payload = {
                allergies: [],
                diets: [],
                religions: [],
                kitchen_equipment: []
            };

            const activeToggles = document.querySelectorAll(".div11.active");
            activeToggles.forEach(toggle => {
                const type = toggle.getAttribute("data-type");
                const id = toggle.getAttribute("data-id");

                if (type === "allergy") payload.allergies.push(id);
                else if (type === "diet") payload.diets.push(id);
                else if (type === "religion") payload.religions.push(id);
                else if (type === "equipment") payload.kitchen_equipment.push(id);
            });

            try {
                const response = await window.AuthAPI.updatePreferences(payload);
                if (response.code === 200 || response.state === "OK") {
                    alert("✨ Изменения успешно сохранены! Профиль обновлен. ✨");
                }
            } catch (error) {
                alert(`Ошибка сохранения: ${error.message}`);
            }
        });
    }
});
