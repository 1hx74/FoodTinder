// Сервер для отладки при недоступности бэка
//Чтобы заработало в api.js 19 строка заменить:
//const API_BASE = "/api/auth";
//на
//const API_BASE = "http://localhost:8000/api/auth";
//Сначала запустить в терминале через команду: node mock-server.js

const http = require("http");

const PORT = 8000;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Обработка предварительного запроса (Preflight) от браузера
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // --- ИМИТАЦИЯ ВХОДА ---
  if (req.method === "POST" && req.url === "/api/auth/login") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        
        // api.js отправляет { username, password }
        if (data.username && data.password) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            user_id: 1,
            username: data.username, // Возвращаем то, что ввели
            access_token: "mock-jwt-token-" + Date.now(),
            code: 200,
            state: "OK"
          }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Введите логин и пароль" }));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Ошибка чтения данных" }));
      }
    });
    return;
  }

  // --- ИМИТАЦИЯ РЕГИСТРАЦИИ (НА БУДУЩЕЕ) ---
  if (req.method === "POST" && req.url === "/api/auth/register") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      user_id: 2,
      username: "НовыйПользователь",
      access_token: "mock-jwt-token-new"
    }));
    return;
  }

  // --- ВСЕ ОСТАЛЬНЫЕ ЗАПРОСЫ ---
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`✅ Мок-сервер успешно запущен на http://localhost:${PORT}`);
  console.log(`Ожидание запросов от фронтенда...`);
});