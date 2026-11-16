/**
 * ДЛЯ ЧЕГО: Изолированный контроллер страницы "Восстановление пароля".
 * Работает строго через глобальный сетевой сервис window.AuthAPI по контракту №8:
 * 1. Шаг 1: Запрашивает код на введенный Email (POST /api/auth/send_code).
 * 2. Шаг 2: Проверяет код и сохраненный Email (POST /api/auth/verify_code), сохраняет reset_token.
 */

document.addEventListener("DOMContentLoaded", () => {
    const emailInput = document.querySelector(".rectangle-7 input");
    const codeInput = document.querySelector(".rectangle-8 input");

    const btnGetCode = document.querySelector(".rectangle-72");
    const btnVerifyCode = document.querySelector(".rectangle-9");

    // Подставляем email, если пользователь уже вводил его в текущей сессии
    const existingEmail = sessionStorage.getItem("recoveryEmail") || sessionStorage.getItem("pendingEmail");
    if (existingEmail && emailInput) {
        emailInput.value = existingEmail;
    }

    // ==========================================
    // ШАГ 1: ЗАПРОС КОДА НА EMAIL (POST /api/auth/send_code)
    // ==========================================
    if (btnGetCode) {
        btnGetCode.addEventListener("click", async (e) => {
            e.preventDefault();
            const email = emailInput ? emailInput.value.trim() : "";

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert("Ошибка: Некорректный формат Email! Проверьте адрес.");
                return;
            }

            btnGetCode.disabled = true;
            try {
                console.log("[recovery.js] Отправка POST /api/auth/send_code:", { email });
                const res = await window.AuthAPI.sendRecoveryCode(email);
                console.log("[recovery.js] Ответ send_code:", res);

                sessionStorage.setItem("recoveryEmail", email);
                alert("✨ Проверочный код отправлен на вашу почту! ✨");
            } catch (error) {
                console.error("[recovery.js] Ошибка отправки кода:", error);
                if (error.status === 404) {
                    alert("Ошибка 404: Пользователь с таким Email не найден.");
                } else {
                    alert(`Ошибка отправки: ${error.message}`);
                }
            } finally {
                btnGetCode.disabled = false;
            }
        });
    }

    // ==========================================
    // ШАГ 2: ПРОВЕРКА КОДА И ПЕРЕХОД (POST /api/auth/verify_code)
    // ==========================================
    if (btnVerifyCode) {
        btnVerifyCode.addEventListener("click", async (e) => {
            e.preventDefault();
            const code = codeInput ? codeInput.value.trim() : "";
            const savedEmail = (emailInput ? emailInput.value.trim() : "") || sessionStorage.getItem("recoveryEmail");

            if (!savedEmail) {
                alert("Ошибка: Сначала введите Email и запросите код на Шаге 1!");
                return;
            }

            if (code.length === 0) {
                alert("Ошибка: Введите проверочный код!");
                return;
            }

            btnVerifyCode.disabled = true;
            try {
                console.log("[recovery.js] Отправка POST /api/auth/verify_code:", { email: savedEmail, code });
                const result = await window.AuthAPI.verifyRecoveryCode(savedEmail, code);
                console.log("[recovery.js] Ответ verify_code:", result);

                if (result && result.reset_token) {
                    localStorage.setItem("resetToken", result.reset_token);
                } else {
                    throw new Error("Сервер не вернул reset_token");
                }

                sessionStorage.removeItem("recoveryEmail");
                alert("Код подтвержден успешно! Переходим к созданию нового пароля.");

                window.location.href = "../newpassword/index.html";
            } catch (error) {
                console.error("[recovery.js] Ошибка проверки кода:", error);
                if (error.status === 400) {
                    alert("Ошибка 400: Неверный проверочный код");
                } else {
                    alert(`Ошибка проверки кода: ${error.message}`);
                }
            } finally {
                btnVerifyCode.disabled = false;
            }
        });
    }
});