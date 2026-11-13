/* global rawRequest, localStorage, document, window */

(function () {
  "use strict";

  const form = document.querySelector(".form-container");
  if (!form) return;

  const loginInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitBtn = document.querySelector(".submit-btn");
  const submitLabel = submitBtn ? submitBtn.querySelector(".div7") : null;

  // Блок для вывода ошибок
  const errorBox = document.createElement("div");
  errorBox.style.cssText = "color: red; font-size: 14px; text-align: center; margin-top: 10px; font-weight: bold;";
  form.appendChild(errorBox);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.textContent = "";

    const loginValue = loginInput.value.trim();
    const password = passwordInput.value;

    if (!loginValue || !password) {
      errorBox.textContent = "Заполните все поля";
      return;
    }

    if (submitLabel) submitLabel.textContent = "Вход...";
    if (submitBtn) submitBtn.disabled = true;

    try {
      // Проверяем, загрузился ли api.js (функция rawRequest)
      if (typeof rawRequest !== "function") {
        throw new Error("Файл api.js не загружен. Проверьте тег <script> в HTML.");
      }

      // Вызываем rawRequest из api.js тимлида
      // Указываем эндпоинт /api/auth/login
      const data = await rawRequest("/api/auth/login", {
        method: "POST",
        body: { username: loginValue, password: password }
      });

      // Сохраняем токен и имя (как задумано в архитектуре)
      if (data && data.access_token) {
        localStorage.setItem("accessToken", data.access_token);
        // Если сервер вернул username (мы это прописали в Python), берем его. Иначе — то, что ввели.
        localStorage.setItem("username", data.username || loginValue);
      }

      // Переход на главную
      window.location.href = "../glavnaya/index.html";

    } catch (error) {
      // Обработка ошибок (ApiError из api.js имеет поле message)
      errorBox.textContent = error.message || "Не удалось войти";
      
      if (submitLabel) submitLabel.textContent = "Войти";
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();