/**
- ДЛЯ ЧЕГО: Это единый глобальный сервис авторизации и поддержания сессии.
- Он управляет сетевыми запросами и глобальным кешем в localStorage.
 */

const API = "localhost";
const API_BASE = `http://${API}`;

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

function formatAuthErrorMessage(status, rawState) {
    const state = String(rawState || "").trim();

    if (status === 400) {
        if (state === "Wrong verification code") return "Неверный код подтверждения.";
        if (state === "Invalid email") return "Некорректный формат Email.";
        return state || "Некорректные данные запроса.";
    }
    if (status === 404) {
        if (state === "User not found") {
            return "Пользователь с таким Email не найден.";
        }

        if (
            state === "Registration not found" ||
            state === "Verification code not found"
        ) {
            return "Заявка на регистрацию или код подтверждения не найдены.";
        }

        if (state === "Password recovery not found") {
            return "Запрос на восстановление пароля не найден. Начните восстановление заново.";
        }

        if (state === "Verification code not found") {
            return "Код подтверждения не найден. Запросите новый.";
        }

        return state || "Запрашиваемые данные не найдены.";
    }
    if (status === 409) {
        if (state === "Email already registered") return "Эта почта уже зарегистрирована.";
        if (state === "User already exists") return "Пользователь с таким именем или почтой уже существует.";
        return state || "Почта или имя пользователя уже заняты.";
    }
    if (status === 410) {
        return "Срок действия кода истёк (5 минут). Запросите новый код.";
    }
    if (status === 429) {
        if (state === "Too many verification attempts") {
            return "Превышено количество попыток (5). Запросите новый код.";
        }
        return "Слишком много запросов. Повторить можно через 60 секунд.";
    }

    return state || "Ошибка запроса к серверу";
}

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
        const rawError = data?.state || data?.message;
        const readableMessage = formatAuthErrorMessage(response.status, rawError);
        throw new ApiError(readableMessage, response.status, data);
    }

    return data;
}

const AuthAPI = {
    async login(email, password) {
        const data = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { email, password }
        });

        if (data && data.access_token) {
            tokenStorage.set(data.access_token);
            const extractedUsername = data.username || email.split("@")[0];
            localStorage.setItem("username", extractedUsername);
            localStorage.setItem("email", email);
        }

        return data;
    },

    // Шаг 1 регистрации: отправляет код на почту, возвращает { code: 200, state: "OK" }
    async register(email, username, password, customEndpoint = "/api/auth/register") {
        return await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, username, password }
        });
    },

    // Шаг 2 регистрации: подтверждает код и сразу авторизует пользователя
    async verifyRegisterCode(email, code, customEndpoint = "/api/auth/register/verify") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, code }
        });
        if (data && data.access_token) {
            tokenStorage.set(data.access_token);
            const pendingUsername = sessionStorage.getItem("pendingUsername");
            const extractedUsername = data.username || pendingUsername || email.split("@")[0];
            localStorage.setItem("username", extractedUsername);
            localStorage.setItem("email", email);

            // Стираем гостевые кэши после успешной регистрации
            
            localStorage.removeItem("guest_cache_liked_ids");
            localStorage.removeItem("guest_cache_disliked_ids");
        }
        return data;
    },

    // Шаг 1 восстановления пароля: отправляет почту + новый пароль, на почту уходит код
    async recoverPassword(email, newPassword, customEndpoint = "/api/auth/password/recover") {
        return await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, new_password: newPassword }
        });
    },

    // Шаг 2 восстановления пароля: подтверждает код, меняет пароль и сбрасывает старые сессии
    async verifyPasswordRecovery(email, code, customEndpoint = "/api/auth/password/recover/verify") {
        const data = await rawRequest(customEndpoint, {
            method: "POST",
            body: { email, code }
        });
        tokenStorage.clear();
        localStorage.removeItem("username");
        localStorage.removeItem("email");
        localStorage.removeItem("global_cache_profile");
        localStorage.removeItem("global_cache_equipment");
        return data;
    },

    async updatePreferences(preferencesData, customEndpoint = "/api/db/me/preferences") {
        const data = await rawRequest(customEndpoint, {
            method: "PATCH",
            body: preferencesData
        });
        localStorage.removeItem("global_cache_equipment");
        return data;
    },

    async getPreferences(customEndpoint = "/api/db/me/preferences") {
        return await rawRequest(customEndpoint, { method: "GET" });
    },

    // --- СХЕМА КЕШИРОВАНИЯ И ПРОВЕРОК ---

    async getCachedEquipment() {
        const cacheKey = "global_cache_equipment";
        let cached = localStorage.getItem(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

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

    getGuestReactionIds(actionType) {
        const key = `guest_cache_${actionType}_ids`;
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch (_) {
            return [];
        }
    },

    addGuestReactionId(recipeId, actionType) {
        if (this.isAuthenticated()) return;
        const key = `guest_cache_${actionType}_ids`;
        let list = this.getGuestReactionIds(actionType);
        if (!list.includes(recipeId)) {
            list.push(recipeId);
            localStorage.setItem(key, JSON.stringify(list));
        }
    },

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

    async uploadAvatar(file) {
        const fd = new FormData();
        fd.append("file", file);

        const headers = {};
        const token = tokenStorage.get();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        let response;
        try {
            response = await fetch(`${API_BASE}/api/db/me/avatar`, {
                method: "POST",
                headers,
                body: fd
            });
        } catch (e) {
            throw new ApiError("Ошибка соединения: сервер недоступен", 0, null);
        }

        let data = null;
        try { data = await response.json(); } catch (_) {}

        if (!response.ok) {
            const rawError = data?.state || data?.message || data?.detail;
            const readableMessage =
                typeof rawError === "string"
                    ? formatAuthErrorMessage(response.status, rawError)
                    : `Ошибка загрузки аватарки (${response.status})`;
            throw new ApiError(readableMessage, response.status, data);
        }

        localStorage.removeItem("global_cache_profile");
        return data;
    },

    async getMyAvatarUrl() {
        const headers = {};
        const token = tokenStorage.get();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        let response;
        try {
            response = await fetch(`${API_BASE}/api/db/me/avatar`, {
                method: "GET",
                headers
            });
        } catch (e) {
            throw new ApiError("Ошибка соединения: сервер недоступен", 0, null);
        }

        if (response.status === 404) {
            return null;
        }

        let data = null;
        try { data = await response.json(); } catch (_) {}

        if (!response.ok) {
            const rawError = data?.state || data?.message || data?.detail;
            const readableMessage =
                typeof rawError === "string"
                    ? formatAuthErrorMessage(response.status, rawError)
                    : `Ошибка получения аватарки (${response.status})`;
            throw new ApiError(readableMessage, response.status, data);
        }

        return data?.avatar_url || null;
    },

    async getNextRecipeId(customEndpoint = "/api/db/recipes/next") {
        if (!this.isAuthenticated()) {
            const liked = this.getGuestReactionIds('liked');
            const disliked = this.getGuestReactionIds('disliked');

            let prefs = {};
            try {
                prefs = JSON.parse(localStorage.getItem("global_cache_equipment")) || {};
            } catch (_) {}

            return await rawRequest(customEndpoint, {
                method: "POST",
                body: {
                    liked: liked,
                    disliked: disliked,
                    exclude: prefs.exclude || [],
                    forbidden: prefs.forbidden || [],
                    religions: prefs.religions || []
                }
            });
        }

        return await rawRequest(customEndpoint, { method: "GET" });
    },

    async getRecipeById(recipeId) {
        return await rawRequest(`/api/db/recipes/${recipeId}`, { method: "GET" });
    },

    async sendRecipeReaction(recipeId, action, customEndpoint = "/api/db/recipes/reaction") {
        if (!this.isAuthenticated() && (action === "like" || action === "dislike")) {
            const actionType = action === "like" ? "liked" : "disliked";
            this.addGuestReactionId(recipeId, actionType);
            return { code: 200, state: "OK (Guest Cached)" };
        }

        const res = await rawRequest(customEndpoint, {
            method: "PUT",
            body: { recipe_id: recipeId, action }
        });

        const cacheKey = `auth_cache_reaction_${action}`;
        let cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
        if (!cached.includes(recipeId)) {
            cached.push(recipeId);
            localStorage.setItem(cacheKey, JSON.stringify(cached));
        }

        return res;
    },

    async getMyAvatarUrl() {
        const headers = {};
        const token = tokenStorage.get();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        let response;
        try {
            response = await fetch(`${API_BASE}/api/db/me/avatar`, {
                method: "GET",
                headers
            });
        } catch (e) {
            throw new ApiError("Ошибка соединения: сервер недоступен", 0, null);
        }

        if (response.status === 404) {
            return null;
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.startsWith("image/")) {
            if (!response.ok) {
                throw new ApiError(`Ошибка получения аватарки (${response.status})`, response.status, null);
            }
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        }

        let rawText = "";
        try { rawText = await response.text(); } catch (_) {}

        let data = null;
        try { data = rawText ? JSON.parse(rawText) : null; } catch (_) {}

        if (!response.ok) {
            const rawError = data?.state || data?.message || data?.detail || rawText;
            const readableMessage =
                typeof rawError === "string"
                    ? formatAuthErrorMessage(response.status, rawError)
                    : `Ошибка получения аватарки (${response.status})`;
            throw new ApiError(readableMessage, response.status, data);
        }

        let avatarUrl = null;
        if (typeof data === "string") {
            avatarUrl = data.replace(/^"+|"+$/g, "");
        } else if (data && typeof data === "object") {
            avatarUrl = data.avatar_url || data.url || data.avatar || null;
        } else if (rawText) {
            avatarUrl = rawText.replace(/^"+|"+$/g, "");
        }

        if (typeof avatarUrl === "string" && avatarUrl.startsWith("/")) {
            avatarUrl = `${API_BASE}${avatarUrl}`;
        }

        return avatarUrl || null;
    },

    setHeaderAvatar(url) {
        const avatarContainer = document.querySelector(".frame-5");
        const baseCircleImg = avatarContainer ? avatarContainer.querySelector(".ellipse-2") : null;
        const profileLetterEl = document.getElementById("profile-letter");
        if (!avatarContainer) return;

        avatarContainer.style.overflow = "hidden";
        avatarContainer.style.borderRadius = "50%";

        let headerAvatarImg = document.getElementById("header-avatar-img");
        if (!headerAvatarImg) {
            headerAvatarImg = document.createElement("img");
            headerAvatarImg.id = "header-avatar-img";
            headerAvatarImg.alt = "Аватар";
            headerAvatarImg.style.position = "absolute";
            headerAvatarImg.style.inset = "0";
            headerAvatarImg.style.width = "100%";
            headerAvatarImg.style.height = "100%";
            headerAvatarImg.style.borderRadius = "50%";
            headerAvatarImg.style.objectFit = "cover";
            headerAvatarImg.style.display = "none";
            avatarContainer.appendChild(headerAvatarImg);
        }

        const showFallback = () => {
            headerAvatarImg.style.display = "none";
            headerAvatarImg.removeAttribute("src");
            if (baseCircleImg) baseCircleImg.style.display = "";
            if (profileLetterEl) {
                profileLetterEl.style.display = "";
                profileLetterEl.style.visibility = "";
            }
        };

        if (url) {
            headerAvatarImg.onload = () => {
                headerAvatarImg.style.display = "block";
                if (baseCircleImg) baseCircleImg.style.display = "none";
                if (profileLetterEl) {
                    profileLetterEl.style.display = "none";
                    profileLetterEl.style.visibility = "hidden";
                }
            };
            headerAvatarImg.onerror = () => {
                console.warn("[api.js] Не удалось загрузить картинку аватарки по ссылке:", url);
                showFallback();
            };
            headerAvatarImg.src = url;
        } else {
            showFallback();
        }
    },
    
    updateHeaderUI() {
        const authContainer = document.getElementById("auth-container");
        const profileLetter = document.getElementById("profile-letter");

        const isAuth = this.isAuthenticated();
        const username = localStorage.getItem("username");

        if (isAuth && username) {
            if (authContainer) {
                authContainer.innerHTML = `<a href="../katalog_vkladok/index.html" class="div4">${username}</a>`;
            }
            if (profileLetter) {
                profileLetter.innerText = username.charAt(0).toUpperCase();
            }
            this.getMyAvatarUrl()
                .then((url) => this.setHeaderAvatar(url))
                .catch(() => this.setHeaderAvatar(null));
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
            this.setHeaderAvatar(null);
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