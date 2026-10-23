/**
 * ДЛЯ ЧЕГО: Это изолированный контроллер конкретно для страницы Регистрации.
 * Он отвечает исключительно за пользовательский интерфейс этой страницы:
 * 1. Перехватывает клик по кнопке отправки и считывает текст из инпутов HTML.
 * 2. Проводит моментальную валидацию почты и совпадения паролей прямо в браузере.
 * 3. Передает чистые данные в глобальный сервис сессий window.AuthAPI.register() 
 * и реагирует на его ответ (выводит окна успеха или ошибки и делает редирект).
 */

document.querySelector('.form-container').addEventListener('submit', async (event) => {
  event.preventDefault(); // Намертво блокируем стандартную перезагрузку страницы браузером

  // Считываем значения из инпутов по ID
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm_password').value;

  //  ВАЛИДАЦИЯ НА СТОРОНЕ ФРОНТЕНДА 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Ошибка: Некорректный формат Email! Проверьте адрес (например, user@mail.ru).");
    return; // Обрываем отправку запроса
  }

  // ЧУТКА ПОЗЖЕ: добавить валидацию на защищенность + соль тут же (и на входе соотвественно)
  if (password.length < 6) {
    alert("Ошибка: Пароль слишком короткий! Придумайте пароль от 6 символов и длиннее.");
    return; // Обрываем отправку запроса
  }

  if (password !== confirmPassword) {
    alert("Ошибка: Пароли не совпадают!");
    return; // Обрываем отправку запроса
  }

  // Вырезаем имя пользователя из Email для соблюдения контракта бэкенда
  const username = email.split('@')[0]; 

  try {
    // ОБРАЩАЕМСЯ К ГЛОБАЛЬНОМУ МЕНЕДЖЕРУ СЕССИЙ ИЗ API.JS
    await window.AuthAPI.register(email, username, password);
    
    // РЕАКЦИЯ НА УСПЕШНОЕ СОЗДАНИЕ СЕССИИ
    alert("✨ Поздравляем! Вы успешно зарегистрированы в FOODTINDER! ✨");
    
    // Чистый фронтенд-переход на главную страницу приложения
    window.location.href = '../glavnaya/index.html'; 

  } catch (error) {
    // Выводим текст ошибки, который сгенерировал и выбросил нам api.js
    alert(`Ошибка регистрации: ${error.message}`);
    console.error("Детали сбоя:", error);
  }
});
