/**
 * ДЛЯ ЧЕГО: Управляет динамическим состоянием шапки главной страницы.
 * Проверяет наличие сессии в localStorage и подставляет имя пользователя 
 * вместо кнопок авторизации, а также меняет аватарку на первую букву имени.
 */

document.addEventListener("DOMContentLoaded", () => {
    // Получаем элементы шапки для динамической подмены текста
    const authContainer = document.getElementById("auth-container");
    const profileLetter = document.getElementById("profile-letter");

    // Извлекаем сохраненные данные авторизации напрямую из памяти браузера
    const token = localStorage.getItem("accessToken");
    const username = localStorage.getItem("username");

    // РЕЖИМ АВТОРИЗОВАННОГО ПОЛЬЗОВАТЕЛЯ (Сессия активна)
    if (token && username) {
        if (authContainer) {
            // Заменяем блок "Вход/Регистрация" на кликабельную ссылку с именем
            authContainer.innerHTML = `
                <a href="#" class="div4">${username}</a>
            `;
        }

        if (profileLetter) {
            // Подставляем в кружок аватарки первую букву имени в верхнем регистре
            profileLetter.innerText = username.charAt(0).toUpperCase();
        }
    } 
    // РЕЖИМ ГОСТЯ (Пользователь не вошел в систему)
    else {
        if (authContainer) {
            // Возвращаем стандартные ссылки на Вход и Регистрацию со слэшем
            authContainer.innerHTML = `
                <a href="../vxod/index.html" class="div4">Вход</a>
                <span class="slash-separator">/</span>
                <a href="../registration/index.html" class="div4">Регистрация</a>
            `;
        }

        if (profileLetter) {
            // Возвращаем дефолтную букву "Г" (Гость) в аватарку
            profileLetter.innerText = "Г";
        }
    }
});
