/**
 * ФАЙЛ: auth.js
 * ДЛЯ ЧЕГО: Логика подтверждения кода.
 * Отправляет код на сервер. При успешной проверке бэкендом перекидывает пользователя на главную.
 */

document.querySelector('.form-container').addEventListener('submit', async function(event) {
    // Блокируем перезагрузку, чтобы сначала отправить запрос на сервер
    event.preventDefault(); 

    // 1. Считываем код из поля ввода
    const code = document.getElementById('verification_code').value.trim();

    // Вытаскиваем email, придержанный в памяти на странице регистрации
    const email = sessionStorage.getItem("pendingEmail") || localStorage.getItem("username") + "@gmail.com";

    try {
        // 2. ИСПРАВЛЕНИЕ: Отправляем код на реальную проверку бэкенду через общий сервис сессий
        const data = await window.AuthAPI.verifyRegisterCode(email, code);

        // 3. Выводим праздничное окно при успешном ответе от сервера
        alert("✨ Регистрация успешно подтверждена! Добро пожаловать! ✨");

        // Очищаем временный email из памяти вкладки
        sessionStorage.removeItem("pendingEmail");

        // 4. С чистой душой выкидываем пользователя на главную страницу
        window.location.href = '/glavnaya';

    } catch (error) {
        // Если сервер вернул 400 Bad Request или 404, выводим его реальную ошибку
        alert(`Ошибка проверки кода: ${error.message || "Invalid code. Попробуйте еще раз."}`);
    }
});
