/**
 * ДЛЯ ЧЕГО: Контроллер страницы Регистрации.
 * Валидирует форму, отправляет POST /api/auth/register (код уходит на почту)
 * и сохраняет данные во временную сессию для страницы подтверждения кода.
 */

document.querySelector('.form-container').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm_password').value;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Ошибка: Некорректный формат Email! Проверьте адрес (например, user@mail.ru).");
    return;
  }

  if (password.length < 6) {
    alert("Ошибка: Пароль слишком короткий! Придумайте пароль от 6 символов и длиннее.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Ошибка: Пароли не совпадают!");
    return;
  }

  const username = email.split('@')[0];

  try {
    await window.AuthAPI.register(email, username, password);

    // Сохраняем данные во временную память до подтверждения кода (нужно для повторной отправки)
    sessionStorage.setItem("pendingFlow", "register");
    sessionStorage.setItem("pendingEmail", email);
    sessionStorage.setItem("pendingUsername", username);
    sessionStorage.setItem("pendingPassword", password);
    sessionStorage.setItem("codeSentAt", String(Date.now()));

    alert("Код подтверждения отправлен на почту ✨");
    window.location.href = '/authentication';

  } catch (error) {
    alert(`Ошибка регистрации: ${error.message}`);
    console.error("Детали сбоя:", error);
  }
});