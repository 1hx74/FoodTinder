/**
 * ДЛЯ ЧЕГО: Это единый глобальный сервис авторизации и поддержания сессии.
 * Он отвечает строго за техническую работу с сетью и токенами:
 * 1. Принимает запросы от страниц, упаковывает их в JSON и отправляет по сети через fetch().
 * 2. Автоматически сохраняет выданный сервером JWT-токен в память браузера (localStorage).
 * Этот файл является общим, его не нужно менять при создании новых страниц форм.
 */

const SERVER_PORT = window.location.port || "8000";
const API_BASE = `http://localhost:${SERVER_PORT}`;

class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

const tokenStorage = {
    get() { return localStorage.getItem("accessToken"); },
    set(token) { localStorage.setItem("accessToken", token); },
    //Добавлен обязательный вызов localStorage для предотвращения ошибки undefined при очистке сессии
    clear() { localStorage.removeItem("accessToken"); }
};

/** Низкоуровневый сетевой fetch-клиент */
async function rawRequest(endpoint, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    
    // Корректируем слэши: гарантируем, что путь начнется со слэша
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    let response;
    try {
        // Идеальная склейка без дублирования двоеточий или слэшей
        response = await fetch(`${API_BASE}${cleanEndpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        // Теперь сюда не будет падать из-за пустого порта в file://
        throw new ApiError("Ошибка соединения: сервер недоступен", 0, null);
    }

    let data = null;
    try { data = await response.json(); } catch (_) {}

    if (!response.ok) {
        throw new ApiError(data?.message || "Ошибка запроса к server.js", response.status, data);
    }

    return data;
}

/** Глобальный объект авторизации, доступный на всем сайте */
const AuthAPI = {

    // ДОБАВЛЕНО: Метод для авторизации по логину/почте
    async login(username, password) {
        const data = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { username, password }
        });

        console.log("[api.js] Ответ входа:", data);

        // Сохраняем токен и имя пользователя в память
        if (data && data.access_token) {
            tokenStorage.set(data.access_token);
            localStorage.setItem("username", data.username || username);
        }

        return data;
    },

    async register(email, username, password, customEndpoint = "/api/auth/register") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, username, password }
        });

        console.log("[api.js] Ответ регистрации:", data);
        // МИНИМАЛЬНОЕ ИЗМЕНЕНИЕ: При двухфакторке токен сохраняется на шаге проверки кода, 
        // поэтому здесь просто возвращаем чистый ответ бэкенда для редиректа.
        return data;
    },

    // ДОБАВЛЕНО: Минимальный метод для проверки кода на странице /authentication
    async verifyRegisterCode(email, code, customEndpoint = "/api/auth/verify_code") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, code }
        });

        console.log("[api.js] Ответ верификации кода:", data);

        // Если код верный и бэкенд отдал токен доступа — сохраняем сессию!
        if (data && data.access_token) {
            localStorage.setItem("accessToken", data.access_token);
            console.log("[api.js] Токен успешно сохранён после ввода кода:", localStorage.getItem("accessToken"));
        }

        return data;
    },

    //Метод сохранения настроек профиля (аллергии, диеты, приборы)
    async updatePreferences(preferencesData, customEndpoint = "/api/db/me/preferences") {
        const data = await rawRequest(customEndpoint, {
            method: "PATCH",
            body: preferencesData
        });

        console.log("[api.js] Ответ сервера на сохранение настроек:", data);
        return data;
    },

    // Получение ранее сохраненных настроек профиля из сессии
    async getPreferences(customEndpoint = "/api/db/me/preferences") {
        return await rawRequest(customEndpoint, {
            method: "GET" // Строго по твоему GET контракту
        });
    },

    //Получение данных текущего профиля пользователя
    async getProfile() {
        return await rawRequest("/api/db/me", {
            method: "GET"
        });
    },

    //Частичное обновление данных профиля и загруженной аватарки
    async updateProfile(profileData) {
        return await rawRequest("/api/db/me", {
            method: "PATCH",
            body: profileData
        });
    },

    //Запрос проверочного кода на Email (восстановление пароля)
    async sendRecoveryCode(email) {
        return await rawRequest("/api/auth/send_code", {
            method: "POST",
            body: { email }
        });
    },

    //Верификация кода с почты
    async verifyRecoveryCode(email, code) {
        return await rawRequest("/api/auth/verify_code", {
            method: "POST",
            body: { email, code }
        });
    },

    //Отправка нового пароля на сервер по выданному токену сброса
    async resetPassword(resetToken, newPassword) {
        return await rawRequest("/api/auth/new_pswd", {
            method: "POST",
            body: { 
                reset_token: resetToken, 
                new_password: newPassword 
            }
        });
    },


    // Глобальная функция автоматического переключения шапки интерфейса
    updateHeaderUI() {
        const authContainer = document.getElementById("auth-container");
        const profileLetter = document.getElementById("profile-letter");

        const token = localStorage.getItem("accessToken");
        const username = localStorage.getItem("username");

        // РЕЖИМ АВТОРИЗОВАННОГО ПОЛЬЗОВАТЕЛЯ
        if (token && username) {
            if (authContainer) {
                authContainer.innerHTML = `<a href="#" class="div4">${username}</a>`;
            }
            if (profileLetter) {
                profileLetter.innerText = username.charAt(0).toUpperCase();
            }
            console.log(`[api.js] Шапка страницы успешно обновлена для пользователя: ${username}`);
        } 
        // РЕЖИМ ГОСТЯ
        else {
            if (authContainer) {
                authContainer.innerHTML = `
                    <a href="../vxod/index.html" class="div4">Вход</a>
                    <span class="slash-separator">/</span>
                    <a href="../registration/index.html" class="div4">Регистрация</a>
                `;
            }
            if (profileLetter) {
                profileLetter.innerText = "Г";
            }
        }
    },

    isAuthenticated() {
        return !!tokenStorage.get();
    }
};

// АВТО-ЗАПУСК: Как только любая страница загрузит api.js, он сам мгновенно перерисует шапку под сессию
document.addEventListener("DOMContentLoaded", () => {
    AuthAPI.updateHeaderUI();
});

// Экспортируем в глобальную видимость окна браузера
window.AuthAPI = AuthAPI;