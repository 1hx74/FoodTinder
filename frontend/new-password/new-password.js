/**
 * ДЛЯ ЧЕГО: Изолированный контроллер конкретно для страницы установки Нового Пароля.
 * Работает строго через глобальный сетевой сервис window.AuthAPI по контракту №8:
 * 1. Перехватывает событие отправки формы после полной загрузки DOM.
 * 2. Проводит валидацию длины пароля (от 6 символов) и совпадения полей.
 * 3. Передает reset_token и new_password в window.AuthAPI.resetPassword() (POST /api/auth/new_pswd).
 */

document.addEventListener("DOMContentLoaded", () => {
    const recoveryForm = document.querySelector(".recovery-form");
    if (!recoveryForm) return;

    const submitBtn = recoveryForm.querySelector(".rectangle-10");

    recoveryForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const passwordInput = document.querySelector(".rectangle-6 input");
        const confirmInput = document.querySelector(".rectangle-7 input");

        const password = passwordInput ? passwordInput.value : "";
        const confirmPassword = confirmInput ? confirmInput.value : "";

        // ВАЛИДАЦИЯ НА СТОРОНЕ ФРОНТЕНДА
        if (password.length < 6) {
            alert("Ошибка: Пароль слишком короткий! Придумайте пароль от 6 символов и длиннее.");
            return;
        }

        if (password !== confirmPassword) {
            alert("Ошибка: Пароли не совпадают!");
            return;
        }

        // Извлекаем реальный токен сброса, полученный на этапе verify_code
        const resetToken = localStorage.getItem("resetToken");
        if (!resetToken) {
            alert("Ошибка: Сессия сброса пароля не найдена. Пройдите подтверждение почты заново.");
            window.location.href = "/password-recovery/";
            return;
        }

        if (submitBtn) submitBtn.disabled = true;
        try {
            console.log("[new-password.js] Отправка POST /api/auth/new_pswd:", {
                reset_token: resetToken,
                new_password: "***"
            });

            const response = await window.AuthAPI.resetPassword(resetToken, password);
            console.log("[new-password.js] Ответ сервера на смену пароля:", response);

            // Удаляем использованный токен сброса из памяти браузера
            localStorage.removeItem("resetToken");

            alert("Пароль успешно изменен!");
            window.location.href = "/login/";
        } catch (error) {
            console.error("[new-password.js] Детали сбоя:", error);

            if (error.status === 422) {
                alert("Ошибка 422: Сервер отклонил пароль (слишком короткий).");
            } else {
                alert(`Ошибка сброса пароля: ${error.message}`);
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
});