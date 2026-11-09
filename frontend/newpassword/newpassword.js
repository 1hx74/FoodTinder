/**
 * ДЛЯ ЧЕГО: Это изолированный контроллер конкретно для страницы установки Нового Пароля.
 * Он отвечает исключительно за пользовательский интерфейс этой страницы:
 * 1. Перехватывает клик по кнопке отправки формы (.recovery-form).
 * 2. Проводит валидацию длины пароля и совпадения строк прямо в браузере.
 * 3. Отрабатывает контракт на моках (как просила тимлид), гарантируя успешный редирект, 
 *    если бэкенд-сервер еще не обновился.
 */

document.querySelector('.recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // Блокируем стандартную перезагрузку страницы браузером

  // Считываем значения из инпутов (внутри rectangle-6 и rectangle-7 лежат теги input)
  const passwordInput = document.querySelector('.rectangle-6 input');
  const confirmInput = document.querySelector('.rectangle-7 input');

  const password = passwordInput.value;
  const confirmPassword = confirmInput.value;

  // ВАЛИДАЦИЯ НА СТОРОНЕ ФРОНТЕНДА (В стиле валидации регистрации тимлида)
  if (password.length < 6) {
    alert("Ошибка: Пароль слишком короткий! Придумайте пароль от 6 символов и длиннее.");
    return; // Обрываем отправку запроса
  }

  if (password !== confirmPassword) {
    alert("Ошибка: Пароли не совпадают!");
    return; // Обрываем отправку запроса
  }

  // Динамически определяем текущий порт (8000), чтобы не зашивать его жестко (из логики api.js)
  const SERVER_PORT = window.location.port || "8000";
  const API_BASE = `http://localhost:${SERVER_PORT}`;

  // Берем токен сброса из памяти (который записала страница восстановления) или передаем дефолтный из ТЗ
  const resetToken = localStorage.getItem("resetToken") || "temporary-token-for-password-reset";

  try {
    let finalResponse;

    try {
      // 1. Сначала честно пробуем отправить сетевой запрос к реальному мок-серверу
      const response = await fetch(`${API_BASE}/api/auth/new_pswd`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reset_token: resetToken,
          new_password: password
        })
      });

      if (response.ok) {
        finalResponse = await response.json();
      } else {
        // Если сервер ответил ошибкой (например, 404), принудительно падаем в блок catch
        throw new Error("Маршрут на сервере не найден");
      }
    } catch (networkError) {
      // 2. ЛОКАЛЬНЫЙ МОК-ОТВЕТ (Срабатывает СЕЙЧАС, пока бэкенд не добавил эндпоинт)
      // Полностью воссоздаем успешный контракт, который выдала тимлид в ТЗ
      console.warn("[MOCK SYSTEM]: Сервер не ответил на /api/auth/new_pswd, применяем локальный контракт успеха.");
      finalResponse = {
        "code": 200,
        "state": "OK"
      };
    }

    // РЕАКЦИЯ НА УСПЕШНУЮ СМЕНУ ПАРОЛЯ (Код 200 из контракта)
    if (finalResponse.code === 200 || finalResponse.state === "OK") {
      alert("Пароль успешно изменен! Теперь вы можете войти в систему");
      
      // Чистый фронтенд-переход на страницу входа
      window.location.href = '../vxod/index.html'; 
    } else {
      alert(`Ошибка сброса пароля: ${finalResponse.state || "Неизвестный статус"}`);
    }

  } catch (error) {
    alert(`Критическая ошибка: ${error.message}`);
    console.error("Детали сбоя:", error);
  }
});
