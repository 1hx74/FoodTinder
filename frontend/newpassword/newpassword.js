/**
 * ДЛЯ ЧЕГО: Это изолированный контроллер конкретно для страницы установки Нового Пароля.
 * Работает строго через глобальный сетевой сервис window.AuthAPI.
 * 1. Перехватывает событие отправки формы.
 * 2. Проводит валидацию длины пароля и совпадения строк прямо в браузере.
 * 3. Передает чистые данные в глобальный сервис сессий window.AuthAPI.resetPassword().
 */

document.querySelector('.recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // Блокируем стандартную перезагрузку страницы браузером

  // Считываем значения из инпутов
  const passwordInput = document.querySelector('.rectangle-6 input');
  const confirmInput = document.querySelector('.rectangle-7 input');

  const password = passwordInput.value;
  const confirmPassword = confirmInput.value;

  // ВАЛИДАЦИЯ НА СТОРОНЕ ФРОНТЕНДА
  if (password.length < 6) {
    alert("Ошибка: Пароль слишком короткий! Придумайте пароль от 6 символов и длиннее.");
    return; // Обрываем отправку запроса
  }

  if (password !== confirmPassword) {
    alert("Ошибка: Пароли не совпадают!");
    return; // Обрываем отправку запроса
  }

  // Берем токен сброса из памяти (который записала страница восстановления) или передаем дефолтный
  const resetToken = localStorage.getItem("resetToken") || "temporary-token-for-password-reset";

  try {
    // Отправляем данные на бэкенд через единый клиент
    await window.AuthAPI.resetPassword(resetToken, password);

    // РЕАКЦИЯ НА УСПЕШНУЮ СМЕНУ ПАРОЛЯ
    alert("Пароль успешно изменен!");
    
    // Чистый фронтенд-переход на страницу входа
    window.location.href = '../vxod/index.html'; 

  } catch (error) {
    alert(`Ошибка сброса пароля: ${error.message}`);
    console.error("Детали сбоя:", error);
  }
});
