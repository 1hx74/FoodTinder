/* global AuthAPI, localStorage, document, window */

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
      // Вызов функции из api.js
      const data = await AuthAPI.login(loginValue, password);
      
      // Сохраняем имя для отображения на других страницах (в каталоге)
      localStorage.setItem("username", data.username || loginValue);
      
      // Переход на главную
      window.location.href = "../glavnaya/index.html";

    } catch (error) {
      errorBox.textContent = error.message || "Не удалось войти";
      
      if (submitLabel) submitLabel.textContent = "Войти";
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();