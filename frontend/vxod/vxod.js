/**
 * vxod.js — логика страницы входа.
 *
 * Зависимости:
 *  - ../api.js  (глобальный объект AuthAPI, функция rawRequest, токен-хранилище)
 *
 * Контракт эндпоинта:
 *  POST /api/auth/login
 *  Тело: { email, password }
 *  Успех (200): { user_id, access_token, code: 200, state: "OK" }
 *  Ошибка (422): { code: 422, state: "Unprocessable Entity", message: "..." }
 */

(function () {
  "use strict";

  const LOGIN_ENDPOINT = "/api/auth/login";
  const REDIRECT_AFTER_LOGIN = "../glavnaya/index.html"; // куда вести после успеха

  // --- DOM ---
  const form = document.querySelector(".form-container");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitBtn = document.querySelector(".submit-btn");
  const submitLabel = submitBtn ? submitBtn.querySelector(".div7") : null;

  if (!form || !emailInput || !passwordInput || !submitBtn) {
    console.error("[vxod.js] Не найдены элементы формы входа");
    return;
  }

  // --- Блок для вывода ошибок/статуса ---
  // Создаём один раз, чтобы не дублировать при повторных ошибках.
  let messageBox = form.querySelector(".form-message");
  if (!messageBox) {
    messageBox = document.createElement("div");
    messageBox.className = "form-message";
    // Вставляем перед кнопкой, чтобы сообщение было видно над ней.
    form.insertBefore(messageBox, submitBtn);
  }

  // Минимальные стили, чтобы сообщение было читаемым (можно вынести в CSS).
  messageBox.style.cssText = [
    "font-family: var(--main-font, sans-serif)",
    "font-size: 13px",
    "line-height: 1.4",
    "text-align: center",
    "display: none",
    "padding: 8px 10px",
    "border-radius: 8px"
  ].join(";");

  /**
   * Показать сообщение пользователю.
   * @param {string} text
   * @param {"error"|"info"|"success"} [type="error"]
   */
  function showMessage(text, type = "error") {
    messageBox.textContent = text;
    messageBox.style.display = "block";

    const palette = {
      error: { color: "#b00020", background: "#fdecea" },
      info: { color: "#333333", background: "#f2f2f2" },
      success: { color: "#1b5e20", background: "#e8f5e9" }
    };
    const style = palette[type] || palette.error;
    messageBox.style.color = style.color;
    messageBox.style.background = style.background;
  }

  function hideMessage() {
    messageBox.style.display = "none";
    messageBox.textContent = "";
  }

  /**
   * Блокировка/разблокировка кнопки на время запроса.
   * @param {boolean} loading
   */
  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.style.opacity = loading ? "0.6" : "";
    submitBtn.style.cursor = loading ? "not-allowed" : "";
    if (submitLabel) {
      submitLabel.textContent = loading ? "Вход..." : "Войти";
    }
  }

  /**
   * Валидация полей на клиенте.
   * @returns {string|null} текст ошибки или null, если всё ок
   */
  function validate(email, password) {
    if (!email || !email.trim()) {
      return "Введите логин или Email";
    }
    if (!password) {
      return "Введите пароль";
    }
    if (password.length < 6) {
      return "Пароль должен содержать минимум 6 символов";
    }
    return null;
  }

  /**
   * Разбор ошибки от api.js (ApiError) в понятный текст.
   * @param {unknown} err
   * @returns {string}
   */
  function resolveErrorMessage(err) {
    if (!err) return "Неизвестная ошибка";

    // ApiError из api.js
    if (err.name === "ApiError") {
      if (err.status === 0) {
        return "Сервер недоступен. Проверьте соединение и попробуйте снова.";
      }
      if (err.status === 422) {
        // Бэк может прислать message с реальной причиной
        return err.data?.message || err.message || "Неверный логин или пароль";
      }
      if (err.status === 401) {
        return err.data?.message || "Неверный логин или пароль";
      }
      if (err.status === 429) {
        return "Слишком много попыток. Попробуйте позже.";
      }
      if (err.status >= 500) {
        return "Ошибка на сервере. Попробуйте позже.";
      }
      return err.data?.message || err.message || "Ошибка запроса к серверу";
    }

    // Сетевые ошибки fetch
    if (err instanceof TypeError) {
      return "Не удалось связаться с сервером. Проверьте соединение.";
    }

    return err.message || "Произошла неизвестная ошибка";
  }

  /**
   * Сохраняет данные успешного входа.
   * Кладём в те же ключи, что использует api.js: accessToken, username.
   * @param {{user_id:number, access_token:string, ...}} data
   * @param {string} emailFallback
   */
  function persistSession(data, emailFallback) {
    if (!data || !data.access_token) {
      throw new Error("Сервер не вернул access_token");
    }
    localStorage.setItem("accessToken", data.access_token);

    const displayName = data.username || data.login || emailFallback;
    if (displayName) {
      localStorage.setItem("username", displayName);
    }
    if (data.user_id != null) {
      localStorage.setItem("userId", String(data.user_id));
    }
  }

  // --- Основной обработчик отправки ---
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const validationError = validate(email, password);
    if (validationError) {
      showMessage(validationError, "error");
      return;
    }

    setLoading(true);

    try {
      // rawRequest доступен глобально (объявлен в api.js через function).
      if (typeof rawRequest !== "function") {
        throw new Error("Сетевой клиент rawRequest не загружен (api.js)");
      }

      const data = await rawRequest(LOGIN_ENDPOINT, {
        method: "POST",
        body: { email, password }
      });

      if (!data || !data.access_token) {
        throw new Error("Сервер не вернул токен авторизации");
      }

      persistSession(data, email);

      showMessage("Вход выполнен. Перенаправляем...", "success");

      window.setTimeout(() => {
        window.location.href = REDIRECT_AFTER_LOGIN;
      }, 400);

    } catch (err) {
      console.error("[vxod.js] Ошибка входа:", err);
      showMessage(resolveErrorMessage(err), "error");
      setLoading(false);
      return;
    }
  });

  // Сброс сообщений при вводе — чтобы не висела старая ошибка.
  [emailInput, passwordInput].forEach((el) => {
    el.addEventListener("input", () => {
      if (messageBox.style.display === "block") hideMessage();
    });
  });
})();