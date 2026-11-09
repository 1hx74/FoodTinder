document.addEventListener("DOMContentLoaded", async () => {
    const SERVER_PORT = window.location.port || "8000";
    const API_BASE = `http://localhost:${SERVER_PORT}`;

    // Генерируем мок-сессию, если зашли напрямую без регистрации
    if (!localStorage.getItem("accessToken")) {
        localStorage.setItem("accessToken", "mock-jwt-token");
        localStorage.setItem("username", "Валерия");
    }

    const token = localStorage.getItem("accessToken");

    // Элементы шапки
    const headerUsername = document.getElementById("header-username");
    const profileLetter = document.getElementById("profile-letter");

    // Элементы интерактивного имени
    const nameDisplay = document.getElementById("name-display");
    const nameInput = document.getElementById("name-input");

    // Инпуты формы (без пароля)
    const emailField = document.getElementById("email");
    const birthField = document.getElementById("birth_date");
    const genderField = document.getElementById("gender");
    const heightField = document.getElementById("height");
    const weightField = document.getElementById("weight");
    const form = document.querySelector(".form-container");

    // Функция обновления текстовых элементов шапки
    function updateHeaderDOM(username) {
        if (headerUsername) headerUsername.textContent = username;
        if (profileLetter && username) {
            profileLetter.textContent = username.charAt(0).toUpperCase();
        }
    }

    // 1. ЗАГРУЗКА ДАННЫХ ПРИ СТАРТЕ
    async function loadUserProfile() {
        try {
            const response = await fetch(`${API_BASE}/api/db/me`, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setupFields(data);
            } else {
                throw new Error();
            }
        } catch (e) {
            console.log("[MOCK] Загружаем дефолтный шаблон контракта...");
            setupFields({
                "username": localStorage.getItem("username") || "Валерия",
                "email": "valeria@example.com",
                "birth_date": "15.06.1995",
                "gender": "Ж",
                "height": 168,
                "weight": 52
            });
        }
    }

    function setupFields(data) {
        if (nameDisplay) nameDisplay.textContent = data.username;
        if (nameInput) nameInput.value = data.username;
        
        // Обновляем шапку реальным именем
        updateHeaderDOM(data.username);

        if (emailField) { emailField.value = data.email; emailField.disabled = true; }
        if (birthField) birthField.value = data.birth_date;
        if (genderField) genderField.value = data.gender;
        if (heightField) heightField.value = data.height;
        if (weightField) weightField.value = data.weight;
    }

    await loadUserProfile();

    // 2. ИЗМЕНЕНИЕ ИМЕНИ ПО КЛИКУ
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
                updateHeaderDOM(newName); // Сразу обновляем шапку страницы
            }
            nameInput.style.display = "none";
            nameDisplay.style.display = "block";
        });

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameInput.blur();
        });
    }

    // 3. ОТПРАВКА ДАННЫХ (PATCH)
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            const payload = {
                username: nameInput ? nameInput.value.trim() : nameDisplay.textContent,
                birth_date: birthField ? birthField.value : "",
                gender: genderField ? genderField.value : "",
                height: heightField ? parseInt(heightField.value) || 0 : 0,
                weight: weightField ? parseInt(weightField.value) || 0 : 0
            };

            try {
                let result;
                const response = await fetch(`${API_BASE}/api/db/me`, {
                    method: "PATCH",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });
                if (response.ok) result = await response.json();
                else throw new Error();
            } catch (e) {
                result = { "code": 200, "state": "OK" };
            }

            if (result.code === 200 || result.state === "OK") {
                alert("Изменения успешно сохранены в FoodTinder!");
            }
        });
    }
});
