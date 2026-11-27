(function () {
  "use strict";

  const REDIRECT_LOGIN = "/login/";
  const REDIRECT_REGISTER = "/registration/";
  const DEFAULT_AVATAR = "/common/default-avatar.svg";

  // DOM-узлы
  const profileName = document.getElementById("profile-name");
  const authLinksBlock = document.getElementById("auth-links");
  const authContainer = document.getElementById("auth-container");
  
  // Аватарки
  const smallAvatarImg = document.querySelector(".frame-5 .ellipse-2");
  const bigAvatarImg = document.getElementById("big-avatar");
  const smallAvatarLetter = document.getElementById("profile-letter");
  const bigAvatarLetter = document.getElementById("big-avatar-letter");

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

  // =========================================================
  // ЗАПРОС ПРОФИЛЯ ДЛЯ ЗАГРУЗКИ АВАТАРОК
  // =========================================================
  async function loadProfileData() {
    if (!isAuthenticated()) return;

    try {
      const profileData = await AuthAPI.getProfile();
      console.log("[katalog] Данные профиля загружены:", profileData);

      if (profileData && profileData.avatar_url) {
        // Если есть реальная картинка — ставим её в обе аватарки и скрываем буквы
        if (smallAvatarImg) smallAvatarImg.src = profileData.avatar_url;
        if (bigAvatarImg) bigAvatarImg.src = profileData.avatar_url;
        if (smallAvatarLetter) smallAvatarLetter.style.display = "none";
        if (bigAvatarLetter) bigAvatarLetter.style.display = "none";
      } else {
        // Если нет — ставим заглушку
        if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
        if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
        if (smallAvatarLetter) smallAvatarLetter.style.display = "";
        if (bigAvatarLetter) bigAvatarLetter.style.display = "";
      }
    } catch (error) {
      console.error("[katalog] Не удалось загрузить профиль:", error);
      if (error.status === 401) logoutUser();
    }
  }

  // =========================================================
  // ОТРИСОВКА ИНТЕРФЕЙСА
  // =========================================================

  function renderGuestState() {
    if (profileName) profileName.textContent = "Гость";
    
    if (authContainer) {
      authContainer.innerHTML = `
        <a href="${REDIRECT_LOGIN}" class="div4">Вход</a>
        <span class="slash-separator">/</span>
        <a href="${REDIRECT_REGISTER}" class="div4">Регистрация</a>
      `;
    }

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

    // Для гостя — картинка-заглушка и буквы "Г"
    if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
    if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
    if (smallAvatarLetter) {
      smallAvatarLetter.textContent = "Г";
      smallAvatarLetter.style.display = "";
    }
    if (bigAvatarLetter) {
      bigAvatarLetter.textContent = "Г";
      bigAvatarLetter.style.display = "";
    }

    guestAllowedTabs.forEach(link => setTabEnabled(link, true));
    guestLockedTabs.forEach(link => setTabEnabled(link, false));
  }

  function renderAuthorizedState() {
    const username = getUsername();

    if (profileName) profileName.textContent = username;

    if (authContainer) {
      authContainer.innerHTML = `<a href="/account/" class="div4">${username}</a>`;
    }

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

    // По умолчанию ставим заглушки и первую букву имени
    if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
    if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
    if (smallAvatarLetter) {
      smallAvatarLetter.textContent = username.charAt(0).toUpperCase();
      smallAvatarLetter.style.display = "";
    }
    if (bigAvatarLetter) {
      bigAvatarLetter.textContent = username.charAt(0).toUpperCase();
      bigAvatarLetter.style.display = "";
    }

    Array.from(tabLinks).forEach(link => setTabEnabled(link, true));

    // Запрашиваем аватарку (если она есть — подставится в оба круга)
    loadProfileData();
  }

  // =========================================================
  // ВЫХОД ИЗ АККАУНТА
  // =========================================================
  async function logoutUser() {
    // Вызываем метод выхода из api.js (он почистит и сервер, и localStorage)
    if (window.AuthAPI && typeof window.AuthAPI.logout === "function") {
      await AuthAPI.logout();
    } else {
      // Страховка, если метод logout не добавлен в api.js
      localStorage.clear();
    }
    
    // Перекидываем на главную
    window.location.href = "/swipe/"; 
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