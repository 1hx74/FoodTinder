/**
 * ДЛЯ ЧЕГО: Изолированный контроллер страницы "Восстановление пароля".
 * Работает строго через глобальный сетевой сервис window.AuthAPI.
 * 1. Шаг 1: Запрашивает код на введенный Email (POST /api/auth/send_code).
 * 2. Шаг 2: Проверяет код, отправляя в контракте И код, И сохраненный Email (POST /api/auth/verify_code).
 */

document.addEventListener("DOMContentLoaded", () => {
    // Находим элементы ввода на странице
    const emailInput = document.querySelector('.rectangle-7 input');
    const codeInput = document.querySelector('.rectangle-8 input');

    // Находим интерактивные кнопки по классам из CSS
    const btnGetCode = document.querySelector('.rectangle-72');
    const btnVerifyCode = document.querySelector('.rectangle-9');

    // ==========================================
    // ШАГ 1: ЗАПРОС КОДА НА EMAIL
    // ==========================================
    if (btnGetCode) {
        btnGetCode.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = emailInput ? emailInput.value.trim() : "";

            // Валидация регулярным выражением
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert("Ошибка: Некорректный формат Email! Проверьте адрес.");
                return;
            }

            try {
                // Вызываем метод из api.js
                await window.AuthAPI.sendRecoveryCode(email);
                
                // Сохраняем в память сессии для Шага 2
                sessionStorage.setItem("pendingEmail", email);
                alert("✨ Проверочный код отправлен на вашу почту! ✨");
            } catch (error) {
                alert(`Ошибка отправки: ${error.message}`);
                console.error(error);
            }
        });
    }

    // ==========================================
    // ШАГ 2: ПРОВЕРКА КОДА И ПЕРЕХОД
    // ==========================================
    if (btnVerifyCode) {
        btnVerifyCode.addEventListener('click', async (e) => {
            e.preventDefault();
            const code = codeInput ? codeInput.value.trim() : "";
            
            // Извлекаем общую почту из сессии
            const savedEmail = sessionStorage.getItem("pendingEmail");

            if (!savedEmail) {
                alert("Ошибка: Сначала запросите код на Шаге 1!");
                return;
            }

            if (code.length === 0) {
                alert("Ошибка: Введите проверочный код!");
                return;
            }

            try {
                // Отправляем данные на верификацию через api.js
                const result = await window.AuthAPI.verifyRecoveryCode(savedEmail, code);
                
                // Сохраняем полученный токен сброса в localStorage для страницы установки нового пароля
                if (result && result.reset_token) {
                    localStorage.setItem("resetToken", result.reset_token);
                }
                
                alert("Код подтвержден успешно! Переходим к созданию нового пароля.");
                
                // Чистый фронтенд-переход на страницу нового пароля
                window.location.href = '../newpassword/index.html';
            } catch (error) {
                alert(`Ошибка проверки кода: ${error.message}`);
                console.error(error);
            }
        });
    }
});
