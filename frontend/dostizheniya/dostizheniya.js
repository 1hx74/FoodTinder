/* global rawRequest, localStorage, document, window */

(function () {
  "use strict";

  const container = document.getElementById("achievements-container");

  // 1. ПРОВЕРКА АВТОРИЗАЦИИ
  const token = localStorage.getItem("accessToken");
  if (!token) {
    window.location.href = "../vxod/index.html";
    return;
  }

  // 2. СПРАВОЧНИК ДОСТИЖЕНИЙ (Живет только на фронтенде)
  const ALL_ACHIEVEMENTS = [
    { id: 1, title: "РЕГИСТРАЦИЯ", desc: "Успешно зарегистрироваться на сайте", icon: "register.svg" },
    { id: 2, title: "ПЕРВЫЙ ЛАЙК", desc: "Поставить лайк первому рецепту", icon: "like.svg" },
    { id: 3, title: "ПЕРВЫЙ ДИЗЛАЙК", desc: "Поставить дизлайк первому рецепту", icon: "dislike.svg" },
    { id: 4, title: "ПЕРВОЕ ИЗБРАННОЕ", desc: "Добавить первый рецепт в избранное", icon: "favorite.svg" },
    { id: 5, title: "100 ЛАЙКОВ", desc: "Поставить лайк 100 рецептам", icon: "like-100.svg" },
    { id: 6, title: "100 ДИЗЛАЙКОВ", desc: "Поставить дизлайк 100 рецептам", icon: "dislike-100.svg" },
    { id: 7, title: "100 В ИЗБРАННОМ", desc: "Добавить 100 рецептов в избранное", icon: "favorite-100.svg" }
  ];

  // 3. ЗАГРУЗКА ДАННЫХ ОТ СЕРВЕРА
  async function loadAchievements() {
    try {
      const data = await rawRequest("/api/db/achievements", { method: "GET" });
      
      // data.achievements - это массив объектов { id: 1, is_unlocked: true }
      renderAchievements(data.achievements || []);
    } catch (error) {
      console.error("Ошибка загрузки достижений:", error);
      container.innerHTML = `<div style="color: red; text-align: center; grid-column: span 2;">Не удалось загрузить достижения</div>`;
    }
  }

  // 4. ОТРИСОВКА
  function renderAchievements(serverData) {
    container.innerHTML = ""; 
    const fragment = document.createDocumentFragment();

    ALL_ACHIEVEMENTS.forEach(localItem => {
      
      // Ищем в ответе сервера данные для этого ID
      const serverItem = serverData.find(item => item.id === localItem.id);
      const isUnlocked = serverItem ? serverItem.is_unlocked : false;
      
      const card = document.createElement("div");
      card.className = `achievement-card ${isUnlocked ? 'unlocked' : 'locked'}`;

      const icon = document.createElement("img");
      icon.className = "achievement-icon";
      icon.alt = localItem.title;
      icon.src = `./icons/${localItem.icon}`; 

      // Страховка: если картинки нет, ставим заглушку
      icon.onerror = () => {
        icon.src = "../glavnaya/ellipse-20.svg"; 
      };

      const title = document.createElement("div");
      title.className = "achievement-title";
      title.textContent = localItem.title;

      const desc = document.createElement("div");
      desc.className = "achievement-desc";
      desc.textContent = localItem.desc;

      card.append(icon, title, desc);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  // Запуск
  loadAchievements();
})();