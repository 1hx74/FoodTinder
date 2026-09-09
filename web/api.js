/**
 * api.js — единая точка работы с бэкендом авторизации.
 *
 * Всё, что нужно фронту:
 *   AuthAPI.login(username, password)
 *   AuthAPI.register(email, username, password)
 *   AuthAPI.logout()
 *   AuthAPI.logoutAll()         -> разлогинить на всех устройствах
 *   AuthAPI.me()                -> данные текущего пользователя
 *   AuthAPI.isAuthenticated()   -> есть ли токен локально (быстрая проверка без запроса)
 *
 * Все методы кидают ApiError с полем .message (текст для пользователя)
 * при неудаче — просто оборачивайте вызов в try/catch.
 *
 * Токен хранится и обновляется автоматически, фронту трогать
 * localStorage / заголовки Authorization не нужно.
 */

const API_BASE = "/api/auth";

/** Ошибка запроса к API. e.message — текст для показа пользователю. */
class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

const tokenStorage = {
    get() {
        return localStorage.getItem("accessToken");
    },
    set(token) {
        localStorage.setItem("accessToken", token);
    },
    clear() {
        localStorage.removeItem("accessToken");
    }
};

/**
 * Низкоуровневый запрос к API.
 * @param {string} endpoint - например "/login"
 * @param {{method?: string, body?: object, auth?: boolean}} options
 */
async function rawRequest(endpoint, { method = "GET", body, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };

    if (auth) {
        const token = tokenStorage.get();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    let response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            method,
            headers,
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        throw new ApiError("Ошибка соединения", 0, null);
    }

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        // тело может быть пустым — не критично
    }

    if (!response.ok) {
        throw new ApiError(data?.detail || "Ошибка запроса", response.status, data);
    }

    return data;
}

/** Обновляет access-токен через refresh-cookie. Возвращает true/false. */
async function refreshAccessToken() {
    try {
        const data = await rawRequest("/refresh", { method: "POST" });
        tokenStorage.set(data.access_token);
        return true;
    } catch (e) {
        tokenStorage.clear();
        return false;
    }
}

/**
 * Запрос с авторизацией. При 401 один раз пытается обновить токен
 * и повторить запрос — фронту не нужно думать про refresh вообще.
 */
async function authRequest(endpoint, options = {}) {
    try {
        return await rawRequest(endpoint, { ...options, auth: true });
    } catch (e) {
        if (e.status === 401) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                return await rawRequest(endpoint, { ...options, auth: true });
            }
        }
        throw e;
    }
}

const AuthAPI = {
    async login(username, password) {
        const data = await rawRequest("/login", {
            method: "POST",
            body: { username, password }
        });
        tokenStorage.set(data.access_token);
        return data;
    },

    async register(email, username, password) {
        const data = await rawRequest("/register", {
            method: "POST",
            body: { email, username, password }
        });
        tokenStorage.set(data.access_token);
        return data;
    },

    async logout() {
        try {
            // Требует Bearer-токен (Depends(get_current_user)) + cookie refresh-token
            await authRequest("/logout", { method: "POST" });
        } finally {
            tokenStorage.clear();
        }
    },

    /** Разлогинить пользователя на всех устройствах (ревокает все refresh-токены). */
    async logoutAll() {
        try {
            await authRequest("/logout_all", { method: "POST" });
        } finally {
            tokenStorage.clear();
        }
    },

    /** Данные текущего пользователя. Кидает ApiError(401), если не авторизован. */
    async me() {
        return await authRequest("/me", { method: "GET" });
    },

    /** Быстрая проверка "есть токен в сторадже" без запроса на сервер. */
    isAuthenticated() {
        return !!tokenStorage.get();
    }
};

window.AuthAPI = AuthAPI;
window.ApiError = ApiError;