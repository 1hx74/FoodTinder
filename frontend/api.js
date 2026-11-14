/**
 * ДЛЯ ЧЕГО: Это единый глобальный сервис авторизации и поддержания сессии.
 * Он управляет сетевыми запросами и глобальным кешем в localStorage.
 */

const API = "localhost";
const API_BASE = `http://${API}:`;

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

async function rawRequest(endpoint, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = tokenStorage.get();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    let response;
    try {
        response = await fetch(`${API_BASE}${cleanEndpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        throw new ApiError("Ошибка соединения: сервер недоступен", 0, null);
    }

    let data = null;
    try { data = await response.json(); } catch (_) {}

    if (!response.ok) {
        throw new ApiError(data?.message || "Ошибка запроса к server.js", response.status, data);
    }

    return data;
}

const AuthAPI = {
    async register(email, username, password, customEndpoint = "/api/auth/register") {
        return await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, username, password }
        });
    },

    async verifyRegisterCode(email, code, customEndpoint = "/api/auth/verify_code") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, code }
        });
        if (data && data.access_token) {
            localStorage.setItem("accessToken", data.access_token);
        }
        return data;
    },

    async updatePreferences(preferencesData, customEndpoint = "/api/db/me/preferences") {
        const data = await rawRequest(customEndpoint, {
            method: "PATCH",
            body: preferencesData
        });
        // Сбрасываем кеш оборудования при обновлении
        localStorage.removeItem("global_cache_equipment");
        return data;
    },

    async getPreferences(customEndpoint = "/api/db/me/preferences") {
        return await rawRequest(customEndpoint, { method: "GET" });
    },

    // --- СХЕМА КЕШИРОВАНИЯ И ПРОВЕРОК ---

    // 1. Кеш оборудования (глобальный)
    async getCachedEquipment() {
        const cacheKey = "global_cache_equipment";
        let cached = localStorage.getItem(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

        // Если не авторизован, у неавторизованных пустой список оборудования по умолчанию
        if (!this.isAuthenticated()) {
            const emptyEq = { kitchen_equipment: [] };
            localStorage.setItem(cacheKey, JSON.stringify(emptyEq));
            return emptyEq;
        }

        try {
            const data = await this.getPreferences();
            if (data) {
                localStorage.setItem(cacheKey, JSON.stringify(data));
                return data;
            }
        } catch (e) {
            console.error("[api.js] Ошибка загрузки оборудования:", e);
        }
        return { kitchen_equipment: [] };
    },

    // 2. Кеш для неавторизованных: Лайки и Дизлайки (списки ID рецептов)
    getGuestReactionIds(actionType) {
        // actionType: 'liked' или 'disliked'
        const key = `guest_cache_${actionType}_ids`;
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch (_) {
            return [];
        }
    },

    addGuestReactionId(recipeId, actionType) {
        if (this.isAuthenticated()) return; // Авторизованные шлют на бэк
        const key = `guest_cache_${actionType}_ids`;
        let list = this.getGuestReactionIds(actionType);
        if (!list.includes(recipeId)) {
            list.push(recipeId);
            localStorage.setItem(key, JSON.stringify(list));
        }
    },

    // 3. Кеш профиля для авторизованных
    async getCachedProfile() {
        const cacheKey = "global_cache_profile";
        let cached = localStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);

        if (!this.isAuthenticated()) return null;

        try {
            const data = await this.getProfile();
            if (data) {
                localStorage.setItem(cacheKey, JSON.stringify(data));
                return data;
            }
        } catch (e) {
            console.error("[api.js] Ошибка загрузки профиля:", e);
        }
        return null;
    },

    async getProfile() {
        return await rawRequest("/api/db/me", { method: "GET" });
    },

    async updateProfile(profileData) {
        const data = await rawRequest("/api/db/me", {
            method: "PATCH",
            body: profileData
        });
        localStorage.removeItem("global_cache_profile");
        return data;
    },

    async sendRecoveryCode(email) {
        return await rawRequest("/api/auth/send_code", { method: "POST", body: { email } });
    },

    async verifyRecoveryCode(email, code) {
        return await rawRequest("/api/auth/verify_code", { method: "POST", body: { email, code } });
    },

    async resetPassword(resetToken, newPassword) {
        return await rawRequest("/api/auth/new_pswd", { method: "POST", body: { reset_token: resetToken, new_password: newPassword } });
    },

    async getNextRecipeId(customEndpoint = "/api/db/recipes/next") {
        return await rawRequest(customEndpoint, { method: "GET" });
    },

    async getRecipeById(recipeId) {
        return await rawRequest(`/api/db/recipes/${recipeId}`, { method: "GET" });
    },

    async sendRecipeReaction(recipeId, action, customEndpoint = "/api/db/recipes/reaction") {
        // Если пользователь не авторизован и это лайк/дизлайк — пишем в локальный кеш ID
        if (!this.isAuthenticated() && (action === "like" || action === "dislike")) {
            const actionType = action === "like" ? "liked" : "disliked";
            this.addGuestReactionId(recipeId, actionType);
            return { code: 200, state: "OK (Guest Cached)" };
        }

        // Если авторизован, отправляем на бэкенд (авторизованные ответы кешируются при необходимости)
        const res = await rawRequest(customEndpoint, {
            method: "PUT",
            body: { recipe_id: recipeId, action }
        });
        
        // Кешируем ответ реакций авторизованного пользователя
        const cacheKey = `auth_cache_reaction_${action}`;
        let cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
        if (!cached.includes(recipeId)) {
            cached.push(recipeId);
            localStorage.setItem(cacheKey, JSON.stringify(cached));
        }

        return res;
    },

    updateHeaderUI() {
        const authContainer = document.getElementById("auth-container");
        const profileLetter = document.getElementById("profile-letter");

        const token = localStorage.getItem("accessToken");
        const username = localStorage.getItem("username");

        if (token && username) {
            if (authContainer) {
                authContainer.innerHTML = `<a href="#" class="div4">${username}</a>`;
            }
            if (profileLetter) {
                profileLetter.innerText = username.charAt(0).toUpperCase();
            }
        } else {
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

document.addEventListener("DOMContentLoaded", () => {
    AuthAPI.updateHeaderUI();
});

window.AuthAPI = AuthAPI;