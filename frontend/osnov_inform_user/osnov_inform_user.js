/**
 * ДЛЯ ЧЕГО: Это изолированный контроллер конкретно для страницы "Основная информация о пользователе".
 * Он отвечает исключительно за пользовательский интерфейс этой страницы:
 * 1. При открытии страницы запрашивает актуальные данные профиля через window.AuthAPI.getProfile() (GET /api/db/me).
 * 2. Обеспечивает интерактивное редактирование имени и выбор аватарки (сжимается до 256x256 и сохраняется на сервере).
 * 3. Передает обновленные данные по контракту (5 полей + avatar_url, если аватар менялся) в window.AuthAPI.updateProfile() (PATCH /api/db/me),
 *    затем делает обратную подгрузку и сверяет: сервер сохранил именно то, что мы отправили.
 */

document.addEventListener("DOMContentLoaded", async () => {
    // Прозрачный пиксель: вместо "битой" картинки показываем серый кружок, если аватара нет или он не загрузился
    const EMPTY_AVATAR = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    /** Обрезает картинку до квадрата и сжимает до size x size, возвращает data URL (jpeg ~20-40 КБ) */
    function resizeImageToDataUrl(file, size = 256) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error("Файл не является изображением"));
                img.onload = () => {
                    const side = Math.min(img.width, img.height);
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = size;
                    canvas.getContext("2d").drawImage(
                        img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size
                    );
                    resolve(canvas.toDataURL("image/jpeg", 0.85));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Элементы аватарки
    const avatarImg = document.getElementById("profile-avatar-img");
    const filePicker = document.getElementById("avatar-file-picker");

    // Элементы интерактивного имени
    const nameDisplay = document.getElementById("name-display");
    const nameInput = document.getElementById("name-input");

    // Поля ввода формы
    const emailField = document.getElementById("email");
    const birthField = document.getElementById("birth_date");
    const genderField = document.getElementById("gender");
    const heightField = document.getElementById("height");
    const weightField = document.getElementById("weight");
    const form = document.querySelector(".form-container");
    const submitBtn = form ? form.querySelector(".submit-btn") : null;

    // Состояние страницы
    let currentName = "";        // актуальное имя: именно оно уйдет на сервер при сохранении
    let pendingAvatar = null;    // новая аватарка (data URL), выбранная, но еще не сохраненная на сервере

    // Если картинка по avatar_url не загрузилась — показываем серый кружок
    if (avatarImg) {
        avatarImg.addEventListener("error", () => {
            if (avatarImg.src !== EMPTY_AVATAR) avatarImg.src = EMPTY_AVATAR;
        });
    }

    function setName(name) {
        currentName = name;
        if (nameDisplay) nameDisplay.textContent = name || "Пользователь";
        if (nameInput) nameInput.value = name;
    }

    // ==========================================
    // 1. ПОЛУЧЕНИЕ ДАННЫХ ПРОФИЛЯ (GET /api/db/me)
    // ==========================================
    /** Возвращает данные профиля или null, если загрузить не удалось */
    async function loadUserProfile() {
        try {
            const data = await window.AuthAPI.getProfile();
            console.log("[profile.js] Данные профиля получены с сервера:", data);

            setName(data.username || "");

            if (emailField) {
                emailField.value = data.email || "";
                emailField.disabled = true;
            }
            if (birthField) birthField.value = data.birth_date || "";
            if (genderField) genderField.value = data.gender || "men";
            if (heightField) heightField.value = data.height ?? "";
            if (weightField) weightField.value = data.weight ?? "";

            // Аватар всегда берем с сервера: так видно, что он действительно сохранился
            if (avatarImg) avatarImg.src = data.avatar_url || EMPTY_AVATAR;
            pendingAvatar = null;

            // Синхронизируем имя с общим сервисом шапки из api.js
            if (data.username) {
                localStorage.setItem("username", data.username);
                if (typeof window.AuthAPI.updateHeaderUI === "function") {
                    window.AuthAPI.updateHeaderUI();
                }
            }
            return data;
        } catch (error) {
            console.error("[profile.js] Ошибка получения профиля:", error);

            if (error.status === 401) {
                alert("Ошибка 401: Пользователь не авторизован. Переходим на страницу входа.");
                window.location.href = "../vxod/index.html";
                return null;
            }

            alert(`Ошибка получения данных профиля: ${error.message}`);
            return null;
        }
    }

    // Первичная загрузка данных при открытии страницы
    await loadUserProfile();

    // ==========================================
    // 2. ИНТЕРАКТИВНАЯ ВЫГРУЗКА АВАТАРКИ (ПРЕВЬЮ + ОТПРАВКА ПО "СОХРАНИТЬ")
    // ==========================================
    if (avatarImg && filePicker) {
        avatarImg.addEventListener("click", () => {
            filePicker.click();
        });

        filePicker.addEventListener("change", async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            if (!file.type.startsWith("image/")) {
                alert("Ошибка: Можно загружать только изображения!");
                return;
            }

            try {
                pendingAvatar = await resizeImageToDataUrl(file);
                avatarImg.src = pendingAvatar; // превью; на сервер уйдет по кнопке "Сохранить"
                console.log("[profile.js] Аватар подготовлен к отправке, символов:", pendingAvatar.length);
            } catch (err) {
                alert(`Ошибка: ${err.message}`);
            } finally {
                filePicker.value = ""; // чтобы можно было выбрать тот же файл повторно
            }
        });
    }

    // ==========================================
    // 3. ИЗМЕНЕНИЕ ИМЕНИ ПО КЛИКУ НА НЕГО
    // ==========================================
    if (nameDisplay && nameInput) {
        nameDisplay.addEventListener("click", () => {
            nameDisplay.style.display = "none";
            nameInput.style.display = "block";
            nameInput.focus();
        });

        nameInput.addEventListener("blur", () => {
            const newName = nameInput.value.trim();
            // Пустое имя не принимаем: возвращаем прежнее, чтобы на сервер не ушла пустая строка
            setName(newName !== "" ? newName : currentName);
            nameInput.style.display = "none";
            nameDisplay.style.display = "block";
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                nameInput.blur();
            }
        });
    }

    // ==========================================
    // 4. ОТПРАВКА ОБНОВЛЕННЫХ ДАННЫХ (PATCH /api/db/me) + ОБРАТНАЯ ПОДГРУЗКА И СВЕРКА
    // ==========================================
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            // По контракту: 5 полей профиля + avatar_url (только если пользователь выбрал новую картинку)
            const payload = {
                username: currentName,
                birth_date: birthField.value,
                gender: genderField.value,
                height: parseInt(heightField.value, 10),
                weight: parseInt(weightField.value, 10)
            };
            if (pendingAvatar) payload.avatar_url = pendingAvatar;

            // ВАЛИДАЦИЯ НА СТОРОНЕ ФРОНТЕНДА (до запроса)
            const today = new Date().toISOString().slice(0, 10);

            if (!payload.username) {
                alert("Ошибка: Имя не может быть пустым!");
                return;
            }
            if (!payload.birth_date || payload.birth_date > today) {
                alert("Ошибка: Укажите корректную дату рождения (не в будущем)!");
                return;
            }
            if (!(payload.height >= 50 && payload.height <= 250)) {
                alert("Ошибка: Рост должен быть от 50 до 250 см!");
                return;
            }
            if (!(payload.weight >= 20 && payload.weight <= 300)) {
                alert("Ошибка: Вес должен быть от 20 до 300 кг!");
                return;
            }

            console.log("[profile.js] Отправка PATCH /api/db/me:", {
                ...payload,
                avatar_url: payload.avatar_url ? `<${payload.avatar_url.length} символов>` : undefined
            });

            if (submitBtn) submitBtn.disabled = true; // защита от двойного клика
            try {
                await window.AuthAPI.updateProfile(payload);

                // Обязательная обратная подгрузка с сервера для проверки сохранения
                const saved = await loadUserProfile();
                if (!saved) return;

                // Сверяем отправленное с полученным: сразу видно, если бэкенд что-то потерял
                const mismatches = Object.keys(payload).filter((key) => saved[key] !== payload[key]);

                if (mismatches.length) {
                    console.warn("[profile.js] Сервер вернул не то, что мы отправили:", mismatches);
                    alert(`Сохранено, но сервер вернул другие значения полей: ${mismatches.join(", ")}`);
                } else {
                    console.log("[profile.js] Сверка прошла: данные на сервере совпадают с отправленными");
                    alert("Профиль успешно сохранен на сервере!");
                }
            } catch (error) {
                console.error("[profile.js] Ошибка сохранения профиля:", error);

                if (error.status === 401) {
                    alert("Ошибка 401: Сессия истекла. Выполните вход заново.");
                    window.location.href = "../vxod/index.html";
                    return;
                }

                alert(`Ошибка сохранения: ${error.message}`);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});