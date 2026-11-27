/**
 * ДЛЯ ЧЕГО: Защита страниц от неавторизованных пользователей.
 * Проверяет наличие токена и его действительность через сервер.
 */

(async function protectPage() {

    // Скрываем содержимое до завершения проверки
    document.documentElement.classList.add("auth-checking");

    // Если токена нет — отправляем на страницу входа
    if (!window.AuthAPI || !AuthAPI.isAuthenticated()) {
        window.location.replace("../vxod/index.html");
        return;
    }

    try {
        // Проверяем действительность токена через запрос профиля
        await AuthAPI.getProfile();

        // Проверка успешна — разрешаем отображение страницы
        document.documentElement.classList.remove("auth-checking");

    } catch (error) {

        // Токен недействителен или истёк
        if (error.status === 401 || error.status === 403) {
            AuthAPI.logout();
            window.location.replace("../vxod/index.html");
            return;
        }

        // При другой ошибке не очищаем токен автоматически
        console.error("Ошибка проверки авторизации:", error);

        document.documentElement.classList.remove("auth-checking");
        alert("Не удалось проверить авторизацию. Попробуйте обновить страницу.");
    }

})();
