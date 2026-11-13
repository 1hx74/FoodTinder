(function () {
  "use strict";

  const REDIRECT_LOGIN = "../vxod/index.html";
  const REDIRECT_REGISTER = "../registration/index.html";
  const REDIRECT_CATALOG = "../katalog_vkladok/index.html"; // Путь в каталог для клика по имени

  // DOM-узлы
  const profileName = document.getElementById("profile-name");
  const authLinksBlock = document.getElementById("auth-links");
  const authContainer = document.getElementById("auth-container");
  const avatarLetter = document.getElementById("profile-letter");

  const tabLinks = document.querySelectorAll(".tab-link");
  
  // Первые 3 кнопки доступны гостю
  const guestAllowedTabs = Array.from(tabLinks).slice(0, 3);
  // Последние 5 кнопок заблокированы
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
      authContainer.innerHTML = `<a href="#" class="div4">${username}</a>`;
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

  // =========================================================
  // КЛИК ПО ИМЕНИ (ГОСТЬ / ИМЯ) В ШАПКЕ ВЕДЕТ В КАТАЛОГ
  // =========================================================
  function setupHeaderNameClick() {
    if (!authContainer) return;

    authContainer.addEventListener("click", (event) => {
      // Проверяем, что кликнули по ссылке <a>
      if (event.target.tagName === "A") {
        const text = event.target.textContent.trim();
        // Если это не "Вход" и не "Регистрация" (они ведут на свои страницы)
        if (text !== "Вход" && text !== "Регистрация") {
          event.preventDefault(); 
          window.location.href = REDIRECT_CATALOG; // Переходим в каталог
        }
      }
    });
  }

  function logoutUser() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("avatarUrl");
    
    window.location.href = "../glavnaya/index.html"; 
  }

  function init() {
    setupHeaderNameClick(); // Подключаем клик по имени в шапке

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