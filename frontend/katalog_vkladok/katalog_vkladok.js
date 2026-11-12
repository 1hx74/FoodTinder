(function () {
  "use strict";

  const REDIRECT_LOGIN = "../vxod/index.html";
  const REDIRECT_REGISTER = "../registration/index.html";
  const AVATAR_FALLBACK = "ellipse-20.svg";

  // --- DOM-узлы ---
  const guestName = document.querySelector(".div5");
  const headerLoginLink = document.querySelector(".frame-4 .div3");
  const headerLoginText = headerLoginLink ? headerLoginLink.querySelector(".div4") : null;
  const authBlock = document.querySelector(".div6");
  const profileLink = document.querySelector(".frame-5");
  const avatarImg = profileLink ? profileLink.querySelector(".ellipse-2") : null;
  const avatarLetter = profileLink ? profileLink.querySelector(".div2") : null;

  // Берем все ссылки-вкладки
  const tabLinks = document.querySelectorAll(".tab-link");
  
  // Первые 3 кнопки (Фильтр, Понравившиеся, Непонравившиеся) — ДОСТУПНЫ ГОСТЮ
  const guestAllowedTabs = Array.from(tabLinks).slice(0, 3);
  
  // Последние 5 кнопок (Инфо, Избранное, Достижения, Планировщик, Список) — ЗАБЛОКИРОВАНЫ ГОСТЮ
  const guestLockedTabs = Array.from(tabLinks).slice(3);

  function isAuthenticated() {
    return !!localStorage.getItem("accessToken");
  }

  function getUsername() {
    return localStorage.getItem("username") || "Пользователь";
  }

  function getInitial(name) {
    const trimmed = (name || "").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  function setTabEnabled(link, enabled) {
    if (!link) return;
    if (enabled) {
      link.classList.remove("is-locked");
    } else {
      link.classList.add("is-locked");
    }
  }

  function renderAuthLinks(container) {
    container.innerHTML = "";
    
    const login = document.createElement("a");
    login.href = REDIRECT_LOGIN;
    login.className = "div7";
    login.innerHTML = '<div class="div4">Вход</div>';

    const slash = document.createElement("div");
    slash.className = "div8";
    slash.textContent = "/";

    const register = document.createElement("a");
    register.href = REDIRECT_REGISTER;
    register.className = "div9";
    register.innerHTML = '<div class="div4">Регистрация</div>';

    container.append(login, slash, register);
  }

  function renderGuestState() {
    if (guestName) guestName.textContent = "Гость";

    if (headerLoginLink) {
      headerLoginLink.href = REDIRECT_LOGIN;
      headerLoginLink.style.display = "";
    }
    if (headerLoginText) headerLoginText.textContent = "Вход";

    if (authBlock) {
      authBlock.style.display = "";
      renderAuthLinks(authBlock);
    }

    // АВАТАР: для гостя возвращаем букву "Г" по центру круга
    if (avatarImg) {
      avatarImg.src = AVATAR_FALLBACK;
      avatarImg.alt = "Профиль гостя";
    }
    if (avatarLetter) {
      avatarLetter.textContent = "Г";
      avatarLetter.style.display = ""; // Показываем букву
    }
    
    // Скрываем динамическую букву имени (если она была)
    const initialEl = profileLink ? profileLink.querySelector(".avatar-initial") : null;
    if (initialEl) initialEl.style.display = "none";

    guestAllowedTabs.forEach(link => setTabEnabled(link, true));
    guestLockedTabs.forEach(link => setTabEnabled(link, false));
  }

  function renderAuthorizedState() {
    const username = getUsername();

    if (guestName) guestName.textContent = username;

    if (headerLoginLink) headerLoginLink.style.display = "none";

    if (authBlock) {
      authBlock.style.display = "";
      authBlock.innerHTML = "";
      const logout = document.createElement("a");
      logout.href = "#";
      logout.className = "div7 logout-link";
      logout.innerHTML = '<div class="div4">Выйти</div>';
      logout.addEventListener("click", (e) => {
        e.preventDefault();
        logoutUser();
      });
      authBlock.appendChild(logout);
    }

    // АВАТАР: для авторизованного пользователя меняем букву "Г" на его инициал
    if (avatarImg) {
      avatarImg.src = AVATAR_FALLBACK;
      avatarImg.alt = `Аватар ${username}`;
    }
    
    if (avatarLetter) {
      avatarLetter.textContent = getInitial(username);
      avatarLetter.style.display = "";
    }

    const initialEl = profileLink ? profileLink.querySelector(".avatar-initial") : null;
    if (initialEl) initialEl.style.display = "none";

    Array.from(tabLinks).forEach(link => setTabEnabled(link, true));
  }

  function logoutUser() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("avatarUrl");
    
    // Перекидываем на главную при выходе (или на страницу входа, если нужно)
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