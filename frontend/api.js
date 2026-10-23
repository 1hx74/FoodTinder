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
        throw new ApiError(data?.message || "Ошибка запроса к серверу", response.status, data);
    }

    return data;
}

/** Глобальный объект авторизации, доступный на всем сайте */
const AuthAPI = {

    async register(email, username, password, customEndpoint = "/api/auth/register") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, username, password }
        });

        console.log("[api.js] Ответ регистрации:", data);

        if (data.access_token) {
            localStorage.setItem("accessToken", data.access_token);
            localStorage.setItem("username", data.username || username);

            console.log("[api.js] Токен сохранён:", localStorage.getItem("accessToken"));
            console.log("[api.js] Имя сохранено:", localStorage.getItem("username"));
        } else {
            console.error("[api.js] Сервер не вернул access_token");
        }

        return data;
    },

    isAuthenticated() {
        return !!tokenStorage.get();
    }
};


// Экспортируем в глобальную видимость окна браузера
window.AuthAPI = AuthAPI;
