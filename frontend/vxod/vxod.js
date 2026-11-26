/**
 * ДЛЯ ЧЕГО: Контроллер страницы Входа.
 * Валидирует форму и отправляет POST /api/auth/login.
 * Выводит уведомления об ошибках в стиле страницы Регистрации (через alert).
 */

document.querySelector('.form-container').addEventListener('submit', async (event) => {
  event.preventDefault();

  // Получаем значения полей
  const loginValue = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const submitBtn = document.querySelector('.submit-btn');
  const submitLabel = submitBtn ? submitBtn.querySelector('.div7') : null;

  // 1. ВАЛИДАЦИЯ (как в регистрации)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Если пользователь ввел почту (есть @), но она кривая — ругаемся
  if (loginValue.includes('@') && !emailRegex.test(loginValue)) {
    alert("Ошибка: Некорректный формат Email! Проверьте адрес.");
    return;
  }

  if (!loginValue) {
    alert("Ошибка: Введите логин или Email!");
    return;
  }

  if (password.length < 6) {
    alert("Ошибка: Пароль слишком короткий! Пароль должен быть от 6 символов.");
    return;
  }

  // 2. ОТПРАВКА НА СЕРВЕР
  if (submitLabel) submitLabel.textContent = "Вход...";
  if (submitBtn) submitBtn.disabled = true;

  try {
    // Вызываем метод из api.js
    await window.AuthAPI.login(loginValue, password);
    
    // api.js уже сохранил токен и имя. Переходим на главную
    window.location.href = "../glavnaya/index.html";

  } catch (error) {
    // 3. ОБРАБОТКА ОШИБОК СЕРВЕРА (через alert)
    alert(`Ошибка входа: ${error.message}`);
    console.error("Детали сбоя:", error);

    // Возвращаем кнопку в исходное состояние
    if (submitLabel) submitLabel.textContent = "Войти";
    if (submitBtn) submitBtn.disabled = false;
  }
});