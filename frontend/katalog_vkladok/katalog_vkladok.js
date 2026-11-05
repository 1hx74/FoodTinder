/**
 * katalog_vkladok.js — логика страницы каталога вкладок.
 *
 * Зависимости:
 *  - ../api.js (window.AuthAPI, токен в localStorage)
 *
 * Поведение:
 *  - Гость: «Гость» + «Вход / Регистрация», серые вкладки недоступны, аватар-заглушка.
 *  - Авторизован: имя пользователя, «Выйти», все вкладки активны, аватар пользователя.
 */

(function () {
  "use strict";

  const REDIRECT_LOGIN = "../vxod/index.html";
  const REDIRECT_REGISTER = "../registration/index.html";
  const AVATAR_FALLBACK = "ellipse-20.svg"; // текущая картинка-заглушка

  // --- DOM-узлы ---
  const guestName = document.querySelector(".div5");                 // «Гость»
  const headerLoginLink = document.querySelector(".frame-4 .div3");  // «Вход» в шапке
  const headerLoginText = headerLoginLink
    ? headerLoginLink.querySelector(".div4")
    : null;

  const authBlock = document.querySelector(".div6");                 // «Вход / Регистрация»
  const profileLink = document.querySelector(".frame-5");            // круг с «Г»
  const avatarImg = profileLink
    ? profileLink.querySelector(".ellipse-2")
    : null;
  const avatarLetter = profileLink
    ? profileLink.querySelector(".div2")
    : null;

  // Серые вкладки (изначально неактивные для гостя)
  const lockedTabs = [
    { link: document.querySelector(".rectangle-9"),  label: document.querySelector(".div14") }, // Основная информация
    { link: document.querySelector(".rectangle-10"), label: document.querySelector(".div15") }, // Избранное
    { link: document.querySelector(".rectangle-11"), label: document.querySelector(".div16") }, // Планировщик недели
    { link: document.querySelector(".rectangle-12"), label: document.querySelector(".div17") }  // Список покупок
  ];

  // --- Утилиты ---

  /** Гость или авторизованный? Опираемся на токен в localStorage (как api.js). */
  function isAuthenticated() {
    return !!localStorage.getItem("accessToken");
  }

  /** Имя пользователя из localStorage (его кладёт vxod.js / api.js). */
  function getUsername() {
    return localStorage.getItem("username") || "Пользователь";
  }

  /** Первая буква имени для аватара-заглушки. */
  function getInitial(name) {
    const trimmed = (name || "").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  /**
   * Устанавливает состояние вкладки: активна/нет.
   * @param {{link: HTMLElement|null, label: HTMLElement|null}} tab
   * @param {boolean} enabled
   */
  function setTabEnabled(tab, enabled) {
    const { link, label } = tab;
    if (!link) return;

    if (enabled) {
      link.style.pointerEvents = "";
      link.style.opacity = "";
      link.removeAttribute("tabindex");
      link.removeAttribute("aria-disabled");
    } else {
      link.style.pointerEvents = "none";
      link.style.opacity = "0.6";
      link.setAttribute("tabindex", "-1");
      link.setAttribute("aria-disabled", "true");
      link.addEventListener("click", preventLockedClick);
    }
    if (label) {
      // Белый текст — и для гостя, и для авторизованного.
      label.style.color = "#ffffff";
    }
  }

  /** Блокировка клика по недоступной вкладке. */
  function preventLockedClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Восстанавливает внутри .div6 «Вход / Регистрация» (если был заменён). */
  function renderAuthLinks(container) {
    container.innerHTML = "";

    const login = document.createElement("a");
    login.href = REDIRECT_LOGIN;
    login.className = "div7";
    const loginText = document.createElement("div");
    loginText.className = "div4";
    loginText.textContent = "Вход";
    login.appendChild(loginText);

    const slash = document.createElement("div");
    slash.className = "div8";
    slash.textContent = "/";

    const register = document.createElement("a");
    register.href = REDIRECT_REGISTER;
    register.className = "div9";
    const registerText = document.createElement("div");
    registerText.className = "div4";
    registerText.textContent = "Регистрация";
    register.appendChild(registerText);

    container.append(login, slash, register);
  }

  /** Показывает «Гость» и «Вход / Регистрация», скрывает имя и «Выйти». */
  function renderGuestState() {
    if (guestName) {
      guestName.textContent = "Гость";
    }

    if (headerLoginLink) {
      headerLoginLink.href = REDIRECT_LOGIN;
      headerLoginLink.style.display = "";
    }
    if (headerLoginText) {
      headerLoginText.textContent = "Вход";
    }

    if (authBlock) {
      authBlock.style.display = "";
      renderAuthLinks(authBlock);
    }

    // Аватар-заглушка: буква «Г» скрыта, картинка-круг на месте.
    if (avatarLetter) avatarLetter.style.display = "none";
    if (avatarImg) {
      avatarImg.src = AVATAR_FALLBACK;
      avatarImg.alt = "Профиль";
    }
    // Убираем букву имени, если осталась с авторизованного состояния.
    if (profileLink) {
      const initialEl = profileLink.querySelector(".avatar-initial");
      if (initialEl) initialEl.style.display = "none";
      profileLink.href = "../katalog_vkladok/index.html";
    }

    // Заблокированные вкладки недоступны
    lockedTabs.forEach((tab) => {
      setTabEnabled(tab, false);
      if (tab.link) {
        tab.link.addEventListener("click", preventLockedClick);
      }
    });
  }

  /** Показывает имя пользователя, «Выйти», активные вкладки, аватар. */
  function renderAuthorizedState() {
    const username = getUsername();

    if (guestName) {
      guestName.textContent = username;
    }

    // «Вход» в шапке скрываем, чтобы не дублировать «Выйти» из блока .div6
    if (headerLoginLink) {
      headerLoginLink.href = "#";
      headerLoginLink.style.display = "none";
    }

    // Блок «Вход / Регистрация» → «Выйти»
    if (authBlock) {
      authBlock.style.display = "";
      authBlock.innerHTML = "";
      const logout = document.createElement("a");
      logout.href = "#";
      logout.className = "div7 logout-link";
      const logoutText = document.createElement("div");
      logoutText.className = "div4";
      logoutText.textContent = "Выйти";
      logout.appendChild(logoutText);
      authBlock.appendChild(logout);

      logout.addEventListener("click", (event) => {
        event.preventDefault();
        logoutUser();
      });
    }

    // Аватар: скрываем букву «Г», ставим картинку/букву пользователя.
    if (avatarLetter) avatarLetter.style.display = "none";
    const avatarUrl = localStorage.getItem("avatarUrl");
    if (avatarImg) {
      avatarImg.src = avatarUrl || AVATAR_FALLBACK;
      avatarImg.alt = `Аватар ${username}`;
    }

    if (profileLink && !avatarUrl) {
      let initialEl = profileLink.querySelector(".avatar-initial");
      if (!initialEl) {
        initialEl = document.createElement("div");
        initialEl.className = "div2 avatar-initial";
        profileLink.appendChild(initialEl);
      }
      initialEl.textContent = getInitial(username);
      initialEl.style.display = "";
      initialEl.style.color = "#ffffff";
    }
    if (profileLink) {
      profileLink.href = "../katalog_vkladok/index.html";
    }

    // Все вкладки активны, текст белый.
    lockedTabs.forEach((tab) => {
      setTabEnabled(tab, true);
      if (tab.link) {
        tab.link.removeEventListener("click", preventLockedClick);
      }
    });
  }

  /** Выход: чистим токен и сессию, перерисовываем гостя. */
  function logoutUser() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    localStorage.removeItem("avatarUrl");
    renderGuestState();
  }

  /** Точка входа. */
  function init() {
    // Текст серых вкладок делаем белым всегда.
    lockedTabs.forEach((tab) => {
      if (tab.label) tab.label.style.color = "#ffffff";
    });

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