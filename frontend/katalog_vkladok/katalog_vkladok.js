(function () {
  "use strict";

  const REDIRECT_LOGIN = "../vxod/index.html";
  const REDIRECT_REGISTER = "../registration/index.html";
  const REDIRECT_CATALOG = "../katalog_vkladok/index.html";
  const DEFAULT_AVATAR = "../glavnaya/ellipse-20.svg";

  // DOM-узлы
  const profileName = document.getElementById("profile-name");
  const authLinksBlock = document.getElementById("auth-links");
  const authContainer = document.getElementById("auth-container");
  
  // Аватарки
  const smallAvatarImg = document.querySelector(".frame-5 .ellipse-2");
  const bigAvatarImg = document.getElementById("big-avatar");
  const avatarLetter = document.getElementById("profile-letter");

  const tabLinks = document.querySelectorAll(".tab-link");
  const guestAllowedTabs = Array.from(tabLinks).slice(0, 3);
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
        // Если есть реальная картинка — ставим её в обе аватарки и скрываем букву
        if (smallAvatarImg) smallAvatarImg.src = profileData.avatar_url;
        if (bigAvatarImg) bigAvatarImg.src = profileData.avatar_url;
        if (avatarLetter) avatarLetter.style.display = "none";
      } else {
        // Если нет — ставим заглушку
        if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
        if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
        if (avatarLetter) avatarLetter.style.display = "";
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

    // Для гостя — картинка-заглушка в обеих аватарках и буква "Г"
    if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
    if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
    if (avatarLetter) {
      avatarLetter.textContent = "Г";
      avatarLetter.style.display = "";
    }

    guestAllowedTabs.forEach(link => setTabEnabled(link, true));
    guestLockedTabs.forEach(link => setTabEnabled(link, false));
  }

  function renderAuthorizedState() {
    const username = getUsername();

    if (profileName) profileName.textContent = username;

    if (authContainer) {
      authContainer.innerHTML = `<a href="#" class="div4">${username}</a>`;
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

    // По умолчанию ставим заглушки и первую букву
    if (smallAvatarImg) smallAvatarImg.src = DEFAULT_AVATAR;
    if (bigAvatarImg) bigAvatarImg.src = DEFAULT_AVATAR;
    if (avatarLetter) {
      avatarLetter.textContent = username.charAt(0).toUpperCase();
      avatarLetter.style.display = "";
    }

    Array.from(tabLinks).forEach(link => setTabEnabled(link, true));

    // Запрашиваем аватарку (если она есть — подставится в оба круга)
    loadProfileData();
  }

  function setupHeaderNameClick() {
    if (!authContainer) return;
    authContainer.addEventListener("click", (event) => {
      if (event.target.tagName === "A") {
        const text = event.target.textContent.trim();
        if (text !== "Вход" && text !== "Регистрация") {
          event.preventDefault(); 
          window.location.href = REDIRECT_CATALOG;
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
    setupHeaderNameClick(); 

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