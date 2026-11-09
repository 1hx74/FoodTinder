/**
 * ДЛЯ ЧЕГО: Интерфейсный контроллер страницы личной информации пользователя.
 * Реализует: интерактивное имя, загрузку, сжатие в бинарную строку и синхронизацию аватарки с FastAPI.
 */
document.addEventListener("DOMContentLoaded", async () => {
    const SERVER_PORT = window.location.port || "8000";
    const API_BASE = `http://localhost:${SERVER_PORT}`;
    const token = localStorage.getItem("accessToken");

    // Элементы аватарки
    const avatarImg = document.getElementById("profile-avatar-img");
    const filePicker = document.getElementById("avatar-file-picker");
    const globalHeaderAvatar = document.querySelector(".frame-5 .ellipse-2"); // Маленькая аватарка в шапке

    // Перехватываем элементы интерактивного имени из Figma
    const nameDisplay = document.getElementById("name-display");
    const nameInput = document.getElementById("name-input");

    // Поля ввода формы
    const emailField = document.getElementById("email");
    const birthField = document.getElementById("birth_date");
    const genderField = document.getElementById("gender");
    const heightField = document.getElementById("height");
    const weightField = document.getElementById("weight");
    const form = document.querySelector(".form-container");

    // Переменная, где будет лежать сжатая в Base64 картинка аватара
    let currentAvatarBase64 = null;

    // Вспомогательная функция обновления шапки
    function updateHeaderUI(username, avatarUrl) {
        const headerUsername = document.querySelector(".div3 .div4");
        const profileLetter = document.getElementById("profile-letter");

        if (headerUsername) headerUsername.textContent = username;
        
        // Симуляция отображения аватарки в других частях приложения:
        if (avatarUrl) {
            // Если аватарка загружена, ставим её и в маленькую иконку шапки, пряча букву
            if (globalHeaderAvatar) globalHeaderAvatar.src = avatarUrl;
            if (profileLetter) profileLetter.style.display = "none"; 
        } else {
            // Если аватарки нет — показываем дефолтную первую букву
            if (profileLetter) {
                profileLetter.style.display = "block";
                profileLetter.textContent = username ? username.charAt(0).toUpperCase() : "Г";
            }
        }
    }

    // 1. ЗАГРУЗКА ДАННЫХ ИЗ БЭКЕНДА ПРИ ОТКРЫТИИ СТРАНИЦЫ
    async function loadUserProfile() {
        try {
            const data = await window.AuthAPI.getProfile();
            
            // Наполняем поля формы реальными значениями из БД
            if (nameDisplay) nameDisplay.textContent = data.username;
            if (nameInput) nameInput.value = data.username;
            if (emailField) { emailField.value = data.email; emailField.disabled = true; }
            if (birthField) birthField.value = data.birth_date;
            if (genderField) genderField.value = data.gender;
            if (heightField) heightField.value = data.height;
            if (weightField) weightField.value = data.weight;

            // Если сервер уже хранит аватарку, отображаем её на странице
            if (data.avatar_url) {
                currentAvatarBase64 = data.avatar_url;
                if (avatarImg) avatarImg.src = data.avatar_url;
            }

            localStorage.setItem("username", data.username);
            updateHeaderUI(data.username, data.avatar_url);

        } catch (error) {
            alert(`Ошибка получения данных профиля: ${error.message}`);
            console.error(error);
        }
    }

    await loadUserProfile();

    // ==========================================
    // ИНТЕРАКТИВНАЯ ВЫГРУЗКА И СЖАТИЕ АВАТАРКИ
    // ==========================================
    if (avatarImg && filePicker) {
        // Клик по кругу аватара симулирует клик по скрытому системному инпуту
        avatarImg.addEventListener("click", () => {
            filePicker.click();
        });

        // Перехватываем момент, когда пользователь выбрал файл в загрузочном окне
        filePicker.addEventListener("change", (event) => {
            const file = event.target.files[0];
            if (!file) return;

            // Проверяем, что это точно картинка
            if (!file.type.startsWith("image/")) {
                alert("Ошибка: Можно загружать только изображения!");
                return;
            }

            // Использование FileReader для перевода файла в бинарную строку (Base64 DataURL)
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64String = e.target.result;
                
                // Сохраняем в переменную для последующей отправки PATCH запроса
                currentAvatarBase64 = base64String;
                
                // Моментально отображаем картинку на экране вместо серого круга
                avatarImg.src = base64String;
                console.log("[FRONTEND] Картинка успешно сжата в бинарный формат Base64");
            };
            reader.readAsDataURL(file); // Запуск процесса бинаризации
        });
    }

    // 2. ИЗМЕНЕНИЕ ИМЕНИ ПО КЛИКУ НА НЕГО
    if (nameDisplay && nameInput) {
        nameDisplay.addEventListener("click", () => {
            nameDisplay.style.display = "none";
            nameInput.style.display = "block";
            nameInput.focus();
        });

        nameInput.addEventListener("blur", () => {
            const newName = nameInput.value.trim();
            if (newName !== "") {
                nameDisplay.textContent = newName;
                localStorage.setItem("username", newName);
                updateHeaderUI(newName, currentAvatarBase64);
            }
            nameInput.style.display = "none";
            nameDisplay.style.display = "block";
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameInput.blur();
        });
    }

    // 3. ОТПРАВКА ОБНОВЛЕННЫХ ДАННЫХ ФОРМЫ + АВАТАРКИ (PATCH)
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            const payload = {
                username: nameInput ? nameInput.value.trim() : nameDisplay.textContent,
                birth_date: birthField ? birthField.value : "",
                gender: genderField ? genderField.value : "",
                height: heightField ? parseInt(heightField.value) || 0 : 0,
                weight: weightField ? parseInt(weightField.value) || 0 : 0,
                avatar_url: currentAvatarBase64 // Передаем нашу сжатую бинарную строку
            };

            try {
                await window.AuthAPI.updateProfile(payload);
                // Синхронизируем глобальный интерфейс шапки
                updateHeaderUI(payload.username, currentAvatarBase64);
                alert("Профиль и аватарка успешно сохранены на сервере!");
            } catch (error) {
                alert(`Ошибка сохранения: ${error.message}`);
            }
        });
    }
});
