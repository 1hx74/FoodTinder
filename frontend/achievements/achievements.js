/* global rawRequest, localStorage, document, window */

(function () {
  "use strict";

  const container = document.getElementById("achievements-container");

  // 1. ПРОВЕРКА АВТОРИЗАЦИИ
  const token = localStorage.getItem("accessToken");
  if (!token) {
    window.location.href = "/login/";
    return;
  }

  // 2. ЗАГРУЗКА ДАННЫХ ОТ СЕРВЕРА
  async function loadAchievements() {
    try {
      const data = await rawRequest("/api/db/achievements", { method: "GET" });
      renderAchievements(data.achievements || []);
    } catch (error) {
      console.error("Ошибка загрузки достижений:", error);
      container.innerHTML = `<div style="color: red; text-align: center; grid-column: span 2;">${error.message || "Не удалось загрузить достижения"}</div>`;
    }
  }

  // 3. ОТРИСОВКА (все данные берем из ответа сервера)
  function renderAchievements(serverData) {
    container.innerHTML = ""; 
    const fragment = document.createDocumentFragment();

    serverData.forEach(item => {
      const card = document.createElement("div");
      // Сервер присылает is_unlocked (true/false), на основе этого ставим класс
      card.className = `achievement-card ${item.is_unlocked ? 'unlocked' : 'locked'}`;

      const icon = document.createElement("img");
      icon.className = "achievement-icon";
      icon.alt = item.title;
      
      // Если сервер прислал ссылку на картинку — берем ее. Если нет — заглушку.
      icon.src = item.icon_url || "/common/default-avatar.svg"; 

      // Страховка, если картинка по ссылке не загрузилась (битая ссылка)
      icon.onerror = () => {
        icon.src = "/common/default-avatar.svg"; 
      };

      const title = document.createElement("div");
      title.className = "achievement-title";
      title.textContent = item.title;

      const desc = document.createElement("div");
      desc.className = "achievement-desc";
      desc.textContent = item.description;

      card.append(icon, title, desc);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  // Запуск
  loadAchievements();
})();