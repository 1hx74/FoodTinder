/**
 * ФАЙЛ: auth.js
 * ДЛЯ ЧЕГО: Подтверждение кода из письма при регистрации,
 * повторная отправка кода с таймером на 60 секунд
 * и очистка временных данных после успешной регистрации.
 */

const RESEND_COOLDOWN_SEC = 60;
let resendTimerId = null;

function clearPendingSession() {
    sessionStorage.removeItem("pendingFlow");
    sessionStorage.removeItem("pendingEmail");
    sessionStorage.removeItem("pendingUsername");
    sessionStorage.removeItem("pendingPassword");
    sessionStorage.removeItem("codeSentAt");

    localStorage.removeItem("guest_cache_liked_ids");
    localStorage.removeItem("guest_cache_disliked_ids");
}

function startResendTimer(resendBtn) {
    if (!resendBtn) return;
    if (resendTimerId) clearInterval(resendTimerId);

    const updateTimer = () => {
        const sentAt = Number(sessionStorage.getItem("codeSentAt")) || Date.now();
        const elapsed = Math.floor((Date.now() - sentAt) / 1000);
        const remaining = Math.max(0, RESEND_COOLDOWN_SEC - elapsed);

        if (remaining > 0) {
            resendBtn.disabled = true;
            resendBtn.innerText = `Отправить код ещё раз (${remaining} с)`;
        } else {
            resendBtn.disabled = false;
            resendBtn.innerText = "Отправить код ещё раз";
            clearInterval(resendTimerId);
            resendTimerId = null;
        }
    };

    updateTimer();
    resendTimerId = setInterval(updateTimer, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
    const resendBtn = document.getElementById("resend-code-btn");

    if (!sessionStorage.getItem("codeSentAt")) {
        sessionStorage.setItem("codeSentAt", String(Date.now()));
    }
    startResendTimer(resendBtn);

    // Обработчик повторного запроса кода регистрации
    if (resendBtn) {
        resendBtn.addEventListener("click", async () => {
            const email = sessionStorage.getItem("pendingEmail");
            const username = sessionStorage.getItem("pendingUsername") || email?.split("@")[0];
            const password = sessionStorage.getItem("pendingPassword");

            if (!email || !password) {
                alert("Данные регистрации утеряны. Заполните форму регистрации заново.");
                window.location.href = '/registration';
                return;
            }

            resendBtn.disabled = true;
            resendBtn.innerText = "Отправка...";

            try {
                await window.AuthAPI.register(email, username, password);
                sessionStorage.setItem("codeSentAt", String(Date.now()));
                alert("Новый код отправлен на почту ✨");
            } catch (error) {
                alert(`Не удалось отправить код: ${error.message}`);
            } finally {
                startResendTimer(resendBtn);
            }
        });
    }
});

document.querySelector('.form-container').addEventListener('submit', async function (event) {
    event.preventDefault();

    const code = document.getElementById('verification_code').value.trim();
    const email = sessionStorage.getItem("pendingEmail");

    if (!email) {
        alert("Сессия регистрации истекла. Заполните форму заново.");
        window.location.href = '/registration';
        return;
    }

    try {
        await window.AuthAPI.verifyRegisterCode(email, code);
        clearPendingSession();

        alert("✨ Регистрация успешно подтверждена! Добро пожаловать! ✨");
        window.location.href = '/glavnaya';
    } catch (error) {
        alert(`Ошибка проверки кода: ${error.message}`);
    }
});