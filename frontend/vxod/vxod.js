(function () {
  "use strict";

  const form = document.querySelector(".form-container");
  if (!form) {
    console.error("❌ ОШИБКА: Форма .form-container не найдена на странице!");
    return;
  }

  const loginInput = document.getElementById("email"); // Поле "Логин/Email"
  const passwordInput = document.getElementById("password");
  const submitBtn = document.querySelector(".submit-btn");
  const submitLabel = submitBtn ? submitBtn.querySelector(".div7") : null;

  // Создаем блок для вывода ошибок прямо под формой
  let errorBox = document.createElement("div");
  errorBox.style.cssText = "color: red; font-size: 14px; text-align: center; margin-top: 10px; font-weight: bold;";
  form.appendChild(errorBox);

  function showError(msg) {
    errorBox.textContent = msg;
  }

  // --- ОТПРАВКА ФОРМЫ ---
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // Останавливаем обычную перезагрузку страницы
    errorBox.textContent = "";
    
    console.log("1. Нажата кнопка 'Войти'");

    const loginValue = loginInput.value.trim();
    const password = passwordInput.value;

    if (!loginValue || !password) {
      showError("Заполните все поля");
      return;
    }

    console.log("2. Данные введены:", { login: loginValue, password: "***" });

    if (submitLabel) submitLabel.textContent = "Вход...";
    if (submitBtn) submitBtn.disabled = true;

    try {
      // Проверяем, загрузился ли api.js
      if (!window.AuthAPI || typeof window.AuthAPI.login !== "function") {
        throw new Error("api.js не загружен или AuthAPI не найден.");
      }

      console.log("3. Вызываем AuthAPI.login...");
      
      // ОТПРАВЛЯЕМ ЗАПРОС
      const data = await window.AuthAPI.login(loginValue, password);
      
      console.log("4. УСПЕХ! Ответ от сервера:", data);

      // Сохраняем имя пользователя (api.js сохраняет только токен)
      localStorage.setItem("username", data.username || loginValue);
      
      console.log("5. Имя сохранено. Переадресация...");

      // Переход на главную
      window.location.href = "../glavnaya/index.html";

    } catch (error) {
      console.error("❌ ОШИБКА ПРИ ВХОДЕ:", error);
      
      // Выводим понятную ошибку на экран
      let errorMsg = "Не удалось войти";
      if (error.message) errorMsg = error.message;
      if (error.status === 401) errorMsg = "Неверный логин или пароль";
      if (error.name === "TypeError" && error.message.includes("fetch")) {
         errorMsg = "Сервер недоступен. Запущен ли mock-server.js?";
      }
      
      showError(errorMsg);
      
      // Возвращаем кнопку в исходное состояние
      if (submitLabel) submitLabel.textContent = "Войти";
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();