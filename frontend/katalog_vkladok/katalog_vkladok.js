(function () {
  "use strict";

  const REDIRECT_LOGIN = "../vxod/index.html";
  const REDIRECT_REGISTER = "../registration/index.html";

  // DOM-узлы
  const profileName = document.getElementById("profile-name");
  const authLinksBlock = document.getElementById("auth-links");
  const authContainer = document.getElementById("auth-container");
  const avatarLetter = document.getElementById("profile-letter");

  // Берем все ссылки-вкладки
  const tabLinks = document.querySelectorAll(".tab-link");
  
  // Первые 3 кнопки (Фильтр, Понравившиеся, Непонравившиеся) — ДОСТУПНЫ ГОСТЮ
  const guestAllowedTabs = Array.from(tabLinks).slice(0, 3);
  
  // Последние 5 кнопок (Инфо, Избранное, Достижения, Планировщик, Список) — ЗАБЛОКИРОВАНЫ
  const guestLockedTabs = Array.from(tabLinks).slice(3);

  function isAuthenticated() {
    return !!localStorage.getItem("accessToken");
  }

  function getUsername() {
    return localStorage.getItem("username") || "Пользователь";
  }

  function setTabEnabled(link, enabled) {
    if (!link) return;
    if (enabled) {
      link.classList.remove("is-locked");
    } else {
      link.classList.add("is-locked");
    }
  }

  function renderGuestState() {
    if (profileName) profileName.textContent = "Гость";
    
    // Шапка: Вход / Регистрация
    if (authContainer) {
      authContainer.innerHTML = `
        <a href="${REDIRECT_LOGIN}" class="div4">Вход</a>
        <span class="slash-separator">/</span>
        <a href="${REDIRECT_REGISTER}" class="div4">Регистрация</a>
      `;
    }

    // Блок под кругом: Вход / Регистрация
    if (authLinksBlock) {
      authLinksBlock.style.display = "";
      authLinksBlock.innerHTML = `
        <a href="${REDIRECT_LOGIN}" class="div7">
          <div class="div4">Вход</div>
        </a>
        <div class="div8">/</div>
        <a href="${REDIRECT_REGISTER}" class="div9">
          <div class="div4">Регистрация</div>
        </a>
      `;
    }

    // Буква в углу: "Г"
    if (avatarLetter) {
      avatarLetter.textContent = "Г";
    }

    guestAllowedTabs.forEach(link => setTabEnabled(link, true));
    guestLockedTabs.forEach(link => setTabEnabled(link, false));
  }

  function renderAuthorizedState() {
    const username = getUsername();

    if (profileName) profileName.textContent = username;

    // Шапка: показываем имя вместо Вход/Регистрация
    if (authContainer) {
      authContainer.innerHTML = `<span class="div4">${username}</span>`;
    }

    // Блок под кругом: Выйти
    if (authLinksBlock) {
      authLinksBlock.style.display = "";
      authLinksBlock.innerHTML = `
        <a href="#" class="logout-link" id="logout-btn">
          <div class="div4">Выйти</div>
        </a>
      `;
      
      document.getElementById("logout-btn").addEventListener("click", (e) => {
        e.preventDefault();
        logoutUser();
      });
    }

    // Буква в углу: первая буква имени
    if (avatarLetter) {
      avatarLetter.textContent = username.charAt(0).toUpperCase();
    }

    // Все кнопки активны
    Array.from(tabLinks).forEach(link => setTabEnabled(link, true));
  }

  function logoutUser() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("avatarUrl");
    
    // Перекидываем на главную
    window.location.href = "../glavnaya/index.html"; 
  }

  function init() {
    if (isAuthenticated()) {
      renderAuthorizedState();
    } else {
      renderGuestState();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();