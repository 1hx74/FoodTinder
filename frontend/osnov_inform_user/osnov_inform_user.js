/**
 * ДЛЯ ЧЕГО: Это изолированный контроллер конкретно для страницы "Основная информация о пользователе".
 * Он отвечает исключительно за пользовательский интерфейс этой страницы:
 * 1. При открытии страницы запрашивает актуальные данные профиля (GET /api/db/me) и аватарку (GET /api/db/me/avatar).
 * 2. Обеспечивает интерактивное редактирование имени и загрузку аватарки на сервер (POST /api/db/me/avatar).
 * 3. Передает обновленные данные профиля (5 полей) в window.AuthAPI.updateProfile() (PATCH /api/db/me),
 *    затем делает обратную подгрузку и сверяет: сервер сохранил именно то, что мы отправили.
 */

document.addEventListener("DOMContentLoaded", async () => {
    const EMPTY_AVATAR = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

    // Элементы аватарки
    const avatarImg = document.getElementById("profile-avatar-img");
    const filePicker = document.getElementById("avatar-file-picker");
    const headerAvatarImg = document.getElementById("header-avatar-img");
    const profileLetterEl = document.getElementById("profile-letter");

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
    let currentName = "";
    let currentAvatarUrl = "";

    if (avatarImg) {
        avatarImg.addEventListener("error", () => {
            if (avatarImg.src !== EMPTY_AVATAR) avatarImg.src = EMPTY_AVATAR;
        });
    }

    function applyHeaderAvatar(url) {
        if (!headerAvatarImg) return;

        if (url) {
            headerAvatarImg.onload = () => {
                headerAvatarImg.style.display = "block";
                if (profileLetterEl) profileLetterEl.style.display = "none";
            };
            headerAvatarImg.onerror = () => {
                headerAvatarImg.style.display = "none";
                if (profileLetterEl) profileLetterEl.style.display = "";
            };
            headerAvatarImg.src = url;
        } else {
            headerAvatarImg.style.display = "none";
            headerAvatarImg.removeAttribute("src");
            if (profileLetterEl) profileLetterEl.style.display = "";
        }
    }

    function setName(name) {
        currentName = name;
        if (nameDisplay) nameDisplay.textContent = name || "Пользователь";
        if (nameInput) nameInput.value = name;
    }

    async function syncAvatarFromServer(fallbackUrl = "") {
        let resolvedUrl = "";
        if (typeof window.AuthAPI.getMyAvatarUrl === "function") {
            resolvedUrl = (await window.AuthAPI.getMyAvatarUrl()) || "";
        }
        if (!resolvedUrl && fallbackUrl) {
            resolvedUrl = fallbackUrl;
        }
        currentAvatarUrl = resolvedUrl;
        if (avatarImg) {
            avatarImg.src = currentAvatarUrl || EMPTY_AVATAR;
        }
        applyHeaderAvatar(currentAvatarUrl);
        return currentAvatarUrl;
    }

    // ==========================================
    // 1. ПОЛУЧЕНИЕ ДАННЫХ ПРОФИЛЯ (GET /api/db/me)
    // ==========================================
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

            await syncAvatarFromServer(data.avatar_url || "");

            if (data.username) {
                localStorage.setItem("username", data.username);
                if (typeof window.AuthAPI.updateHeaderUI === "function") {
                    window.AuthAPI.updateHeaderUI();
                }
            }
            return { ...data, avatar_url: currentAvatarUrl || data.avatar_url || "" };
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

    await loadUserProfile();

    // ==========================================
    // 2. ЗАГРУЗКА АВАТАРКИ (POST /api/db/me/avatar)
    // ==========================================
    if (avatarImg && filePicker) {
        avatarImg.addEventListener("click", () => {
            filePicker.click();
        });

        filePicker.addEventListener("change", async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
                alert("Ошибка: Поддерживаются только форматы JPEG, PNG, WEBP и GIF!");
                filePicker.value = "";
                return;
            }

            if (file.size === 0 || file.size > MAX_AVATAR_BYTES) {
                alert("Ошибка: Размер файла должен быть больше 0 и не превышать 5 МБ!");
                filePicker.value = "";
                return;
            }

            try {
                const uploadRes = await window.AuthAPI.uploadAvatar(file);
                const newUrl = uploadRes?.avatar_url || (await window.AuthAPI.getMyAvatarUrl()) || "";
                currentAvatarUrl = newUrl;
                avatarImg.src = currentAvatarUrl || EMPTY_AVATAR;
                applyHeaderAvatar(currentAvatarUrl);
                localStorage.removeItem("global_cache_profile");
                console.log("[profile.js] Аватар загружен:", currentAvatarUrl);
                alert("Аватарка успешно обновлена!");
            } catch (error) {
                console.error("[profile.js] Ошибка загрузки аватарки:", error);
                if (error.status === 401) {
                    alert("Ошибка 401: Пользователь не авторизован. Переходим на страницу входа.");
                    window.location.href = "../vxod/index.html";
                    return;
                }
                alert(`Ошибка загрузки аватарки: ${error.message}`);
            } finally {
                filePicker.value = "";
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

            const payload = {
                username: currentName,
                birth_date: birthField.value,
                gender: genderField.value,
                height: parseInt(heightField.value, 10),
                weight: parseInt(weightField.value, 10)
            };

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

            console.log("[profile.js] Отправка PATCH /api/db/me:", payload);

            if (submitBtn) submitBtn.disabled = true;
            try {
                await window.AuthAPI.updateProfile(payload);

                const saved = await loadUserProfile();
                if (!saved) return;

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