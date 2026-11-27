/**
 * ДЛЯ ЧЕГО: Изолированный контроллер страницы "Восстановление пароля".
 * 1. Шаг 1: Отправляет Email и новый пароль (POST /api/auth/password/recover),
 *    блокирует кнопку на 60 сек с обратным отсчётом.
 * 2. Шаг 2: Подтверждает код (POST /api/auth/password/recover/verify),
 *    сбрасывает старую сессию и перенаправляет на вход.
 */

const RECOVERY_COOLDOWN_SEC = 60;

document.addEventListener("DOMContentLoaded", () => {
    const emailInput = document.getElementById("recovery-email") || document.querySelector(".rectangle-7 input");
    const newPasswordInput = document.getElementById("recovery-new-password");
    const confirmPasswordInput = document.getElementById("recovery-confirm-password");
    const codeInput = document.getElementById("recovery-code") || document.querySelector(".rectangle-8 input");

    const btnGetCode = document.querySelector(".rectangle-72");
    const btnGetCodeLabel = btnGetCode?.querySelector(".div10") || btnGetCode;
    const btnVerifyCode = document.querySelector(".rectangle-9");

    let cooldownTimerId = null;

    function setGetCodeDisabled(disabled, text) {
        if (!btnGetCode) return;
        btnGetCode.disabled = disabled;
        btnGetCode.setAttribute("aria-disabled", String(disabled));
        btnGetCode.style.pointerEvents = disabled ? "none" : "";
        btnGetCode.style.opacity = disabled ? "0.6" : "";
        if (btnGetCodeLabel && text) {
            btnGetCodeLabel.innerText = text;
        }
    }

    function startCooldown(sentAtMs) {
        if (cooldownTimerId) clearInterval(cooldownTimerId);

        const tick = () => {
            const elapsed = Math.floor((Date.now() - sentAtMs) / 1000);
            const remaining = Math.max(0, RECOVERY_COOLDOWN_SEC - elapsed);

            if (remaining > 0) {
                setGetCodeDisabled(true, `Запросить повторно можно через ${remaining} с`);
            } else {
                clearInterval(cooldownTimerId);
                cooldownTimerId = null;
                setGetCodeDisabled(false, "Получить код");
            }
        };

        tick();
        cooldownTimerId = setInterval(tick, 1000);
    }

    const savedEmail = sessionStorage.getItem("pendingRecoveryEmail");
    const savedNewPassword = sessionStorage.getItem("pendingRecoveryPassword");
    const savedSentAt = Number(sessionStorage.getItem("recoveryCodeSentAt"));

    if (savedEmail && emailInput) emailInput.value = savedEmail;
    if (savedNewPassword && newPasswordInput) newPasswordInput.value = savedNewPassword;
    if (savedSentAt) {
        const elapsed = Math.floor((Date.now() - savedSentAt) / 1000);
        if (elapsed < RECOVERY_COOLDOWN_SEC) {
            startCooldown(savedSentAt);
        }
    }

    // ==========================================
    // ШАГ 1: ОТПРАВКА EMAIL + НОВОГО ПАРОЛЯ
    // ==========================================
    if (btnGetCode) {
        btnGetCode.addEventListener("click", async (e) => {
            e.preventDefault();
            if (btnGetCode.disabled) return;

            const email = emailInput ? emailInput.value.trim() : "";
            const newPassword = newPasswordInput ? newPasswordInput.value : "";
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : newPassword;

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert("Ошибка: Некорректный формат Email! Проверьте адрес.");
                return;
            }

            if (newPassword.length < 6) {
                alert("Ошибка: Новый пароль должен быть не короче 6 символов.");
                return;
            }

            if (confirmPasswordInput && newPassword !== confirmPassword) {
                alert("Ошибка: Пароли не совпадают!");
                return;
            }

            setGetCodeDisabled(true, "Отправка...");

            try {
                await window.AuthAPI.recoverPassword(email, newPassword);

                const now = Date.now();
                sessionStorage.setItem("pendingRecoveryEmail", email);
                sessionStorage.setItem("pendingRecoveryPassword", newPassword);
                sessionStorage.setItem("recoveryCodeSentAt", String(now));

                startCooldown(now);
                alert("✨ Код подтверждения отправлен на вашу почту! ✨");
            } catch (error) {
                alert(`Ошибка отправки: ${error.message}`);
                console.error(error);

                if (error.status === 429) {
                    const now = Number(sessionStorage.getItem("recoveryCodeSentAt")) || Date.now();
                    startCooldown(now);
                } else {
                    setGetCodeDisabled(false, "Получить код");
                }
            }
        });
    }

    // ==========================================
    // ШАГ 2: ПРОВЕРКА КОДА И СМЕНА ПАРОЛЯ
    // ==========================================
    if (btnVerifyCode) {
        btnVerifyCode.addEventListener("click", async (e) => {
            e.preventDefault();
            const code = codeInput ? codeInput.value.trim() : "";
            const targetEmail = (emailInput?.value.trim()) || sessionStorage.getItem("pendingRecoveryEmail");

            if (!targetEmail) {
                alert("Ошибка: Сначала введите Email и новый пароль и запросите код!");
                return;
            }

            if (!code) {
                alert("Ошибка: Введите проверочный код!");
                return;
            }

            try {
                await window.AuthAPI.verifyPasswordRecovery(targetEmail, code);

                // Все старые сессии разлогинены — очищаем локальные данные и отправляем на вход
                localStorage.removeItem("accessToken");
                localStorage.removeItem("username");
                localStorage.removeItem("email");
                sessionStorage.removeItem("pendingRecoveryEmail");
                sessionStorage.removeItem("pendingRecoveryPassword");
                sessionStorage.removeItem("recoveryCodeSentAt");

                alert("✨ Пароль успешно изменён! Войдите с новым паролем. ✨");
                window.location.href = "/login/";
            } catch (error) {
                alert(`Ошибка проверки кода: ${error.message}`);
                console.error(error);
            }
        });
    }
});