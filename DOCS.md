# FoodTinder

## Запуск

В корне репозитория (нужны файлы `.env` у сервисов и `backend/auth/secrets/jwt_private.pem`):

```bash
docker compose up -d --build
```

Сайт откроется на порту 80:

- локально: http://localhost/
- на сервере: `http://<IP или домен>/` (тот же адрес, что в `PUBLIC_BASE_URL` корневого `.env`)

`/` сразу открывает свайпы (`/swipe/`). Другие страницы — `/login/`, `/planner/`, `/account/` и т.д. Папка `frontend/home/` в репозитории есть, но сайт её не отдаёт: `/home/` отвечает 301 на свайпы.

Фронт отдаёт контейнер `ft-nginx`: папка `frontend/` монтируется в `/usr/share/nginx/html`.
Общие ассеты лежат в `frontend/common/` (`base.css` / `vars.css`, `api.js`, `auth-guard.js`, `recipe-card.css`, `recipe-card.js`).
`frontend/common/api.js` ходит к API относительно текущего хоста (`/api/...`), поэтому IP сервера в JS прописывать не нужно.
Не открывайте `index.html` как `file://` — запросы к API не уйдут.

`PUBLIC_BASE_URL` в корневом `.env` нужен бэку: из него собираются абсолютные ссылки `avatar_url`, `image_url` и `hyper-text`.
На CORS фронта он не влияет (сайт и API — один origin на порту 80; на бэке CORS и так `*`).
Письма с кодами подтверждения почты ссылок на фронт не содержат.

# Swagger (/docs) сервисов

Адреса для локального запуска (`docker compose up --build -d`).

| Сервис    | Контейнер     | Docs                            | Доступ                     | Что делает                                                     |
|-----------|---------------|---------------------------------|----------------------------|----------------------------------------------------------------|
| auth      | ft-auth       | http://localhost:8080/docs      | открыт наружу (порт 8080)  | регистрация, логин, JWT, JWKS (`/api/auth/*`, `/.well-known/`) |
| recipes   | ft-recipes    | http://localhost:8000/docs      | открыт наружу (порт 8000)  | рецепты, лайки/дизлайки/избранное, next, профиль и фильтры (`/api/db/*`, `/api/db/me`, `/api/db/me/preferences`) |
| fileloud  | ft-fileloud   | http://localhost:8001/docs      | только localhost хоста     | хранилище файлов (MinIO + SQLite), напрямую фронтом не используется |
| media     | ft-media      | http://localhost:8002/docs      | только localhost хоста     | аватар, фото рецептов, гипертекст (`/api/db/me/avatar`, `/api/db/avatar/{id}`, `/api/db/image`, `/api/db/hyper-text`) |
| email_verificator | ft-email-verificator | http://localhost:8003/docs | только localhost хоста | коды подтверждения почты (`/api/mail/send`, `/api/mail/verify`), вызывается только из auth |

Сайт и всё API через nginx: http://localhost (порт 80).

ReDoc у каждого сервиса тоже есть: замени `/docs` на `/redoc`.

MinIO (S3 для fileloud) и Postgres наружу не опубликованы, доступны только внутри docker-сети.

## Адрес сайта (для деплоя)

Публичный адрес задаётся в одном месте: `PUBLIC_BASE_URL` в `.env` в корне проекта
(шаблон в `.env.example`). Можно IP или домен: `http://203.0.113.10`, `https://foodtinder.ru`.
От него собираются ссылки `avatar_url`, `image_url`, `hyper-text`, которые отдаёт бэк
(media — при загрузке, recipes — при первом сиде демо-рецептов).
Фронт этот адрес не хардкодит: запросы идут на `/api/...` того же хоста, с которого открыт сайт.
После изменения: `docker compose up -d --force-recreate media recipes`.

## Демо-рецепты

При старте recipes, если таблица `recipes` пуста, создаются 16 демо-рецептов.
Их фото и гипертекст (пошаговая инструкция с картинкой на каждый шаг) скачиваются
с eda.ru / 1000.menu и кладутся в fileloud (ссылки на источники — `backend/recipes/seed_content.py`).
Нужен интернет; если что-то не скачалось — рецепты всё равно создаются, в логах recipes будет warning.
Пересоздать демо-рецепты с нуля: `docker compose down -v && docker compose up --build -d`
(удалит ВСЕ данные: пользователей, рецепты, файлы).

Кроме 16 демо-рецептов, сид берёт ещё ~144 рецепта с eda.ru из `backend/recipes/recipes200.json`
(загрузчик — `backend/recipes/seed_extra.py`; файла нет — только 16 демо). Они тоже вставляются
только в пустую таблицу. При первом старте качается ~1500 картинок, recipes поднимается несколько
минут; `SEED_MEDIA=false` — без скачивания (фото по ссылкам источника, без гипертекста).
`SEED_EXTRA=false` — не грузить recipes200.json.

КБЖУ рецепта (`kalories`, `belki`, `fats`, `uglevods`) — **на 100 г** готового блюда,
`final_weight` — вес всего блюда в граммах. КБЖУ порции весом `weight` г:
`kalories * weight / 100` (так же белки, жиры, углеводы); всё блюдо — `weight = final_weight`.
Админские `POST /api/db/recipes` и `PATCH /api/db/recipes/{id}` принимают КБЖУ `>= 0`
(например, жиры у напитков — 0), `final_weight` — `>= 1`.

## Подтверждение почты (регистрация и восстановление пароля)

Сервис `backend/email_verificator` (взят из https://github.com/1hx74/email_verificator)
генерирует 6-значный код, хранит его хэш в SQLite (docker-том `email_codes`) и шлёт письмо через Gmail.
Наружу не опубликован, его вызывает только auth.

- Регистрация: `POST /api/auth/register` (email, username, password) -> код на почту ->
  `POST /api/auth/register/verify` (email, code). Пока код не подтверждён, пользователя в `members` нет
  (данные лежат в `pending_registrations`, живут `PENDING_TTL` секунд, по умолчанию 15 минут).
- Восстановление пароля: `POST /api/auth/password/recover` (email, new_password) -> код на почту ->
  `POST /api/auth/password/recover/verify` (email, code). После этого все сессии пользователя разлогиниваются.
- Смена пароля (уже залогинен): `POST /api/auth/change_pswd` с `Authorization: Bearer <access_token>`
  и телом `{old_password, new_password}`. Код с почты не нужен. Новый пароль — не короче 6 символов.
  Неверный старый пароль — 403, новый совпадает со старым — 409, короткий/невалидный — 422.
  После успешной смены все refresh-токены отзываются (нужно залогиниться заново).
  Без токена — 401 `{"detail": ...}`.

Почта отправителя — `GMAIL` и `APP_PASSWORD` в `backend/email_verificator/.env`.
`APP_PASSWORD` — пароль приложения Google (https://myaccount.google.com/apppasswords,
нужна двухэтапная аутентификация), а не пароль от почты.
Если они пустые — DEV-режим: письмо не отправляется, код печатается в лог:
`docker compose logs email_verificator`.

## Текущий пользователь (`/api/db/me`)

Сервис recipes. Нужен `Authorization: Bearer <access_token>`, без него 401 `{"detail": ...}`.

- `GET /api/db/me` — всё о пользователе одним запросом (вместо `/api/db/me/short`):
  `user_id`, `username`, `email`, `avatar_url` (абсолютная ссылка или `null`),
  `birth_date` (`ГГГГ-ММ-ДД`), `gender` (`men`/`women`), `height` (см), `weight` (кг) — `null`, пока не заполнены,
  `role`, `created_at`, `preferences` (как в `GET /api/db/me/preferences`).
  Имя/почта/роль — из таблицы `members` (auth), аватар — из `user_avatars` (media),
  анкета — из `user_profiles`, фильтры — из `user_preferences` (обе таблицы recipes, создаются сами при старте).
- `PATCH /api/db/me` — `{username?, birth_date?, gender?, height?, weight?}`, всё необязательно
  (не прислали или `null` — не меняется). Проверки: имя 1..32 символа и не занято (иначе 409),
  дата `ГГГГ-ММ-ДД` не в будущем, пол `men`/`women`, рост 50..250, вес 20..300 — иначе 422.
  Имя меняется в `members.name`. Аватар сюда не передаётся — `POST /api/db/me/avatar`.
- `GET /api/db/me/preferences` — фильтры `{allergies, diets, religions, kitchen_equipment}`
  (в списках только включённые ограничения); ничего не сохранено — пустые списки.
- `PATCH /api/db/me/preferences` — каждое поле необязательно: не прислали — не меняется, прислали список —
  он заменяет сохранённый целиком (`[]` — очистить). Неизвестный код или код не из своего поля -> 422.
  - `allergies` — аллергии: `nuts, seafood, lactose, fish, eggs, wheat, citruses`
  - `diets` — диеты: `vegan, vegetarian`
  - `religions` — религия: `halal, lenten`
  - `kitchen_equipment` — оборудование: `oven, stove, microwave, multicooker, air_fryer, toaster, waffle_maker,
    mixer, blender, meat_grinder, backing_dish, backind_sheet, grater, wisk, rolling_scale` (опечатки — как во фронте)
- `GET /api/db/recipes/next` для авторизованного не выдаёт рецепты, которые нарушают его сохранённые
  `allergies`, `diets` и `religions`. По оборудованию бэк не фильтрует.
  Дальше выбор делает рекомендательная система
  (`backend/recipes/recommender_system/recommender.py`, подключение —
  `backend/recipes/recommender_adapter.py`): скор по тегам из лайков/дизлайков,
  штраф за недавний показ, избранное учитывается как лайк. Лента циклическая —
  уже показанный или оценённый рецепт может вернуться (дизлайкнутый — с штрафом,
  не исключается насовсем). `exclude` — только id, которые клиент уже держит
  в очереди. Показ по-прежнему пишется в `recipe_impressions`.
- Анонимный `POST` / `PATCH /api/db/recipes/next` (фронт шлёт `PATCH`, `POST`
  оставлен для совместимости). Тело JSON:
  - `liked` / `disliked` — id из кэша клиента, идут в тот же рекомендатель
    (не выкидывают рецепт из круга);
  - `allergies` (или старое `forbidden`) — аллергии;
  - `diets` и `religions` (или старое `religions` сразу с диетами:
    `halal, lenten, vegan, vegetarian`) — как поля рецепта. Рецепты, которые
    их нарушают, не выдаются. Неизвестный код -> 422;
  - `kitchen_equipment` — принимается, бэк по нему не фильтрует;
  - `excluded_recipe_ids` — уже показанные id (порядок: старые первые, свежие
    в конце; фронт обычно шлёт последние 50). Попадают в историю показов
    рекомендателя, чтобы сработал штраф recency. Пока есть подходящие ещё
    не показанные рецепты, показанные не возвращаются. Если все кандидаты
    уже в этом списке — возвращается самый давно показанный (цикл), а не
    ошибка и не пустой список;
  - `exclude` — очередь клиента, эти id сейчас не отдаём.
  В БД ничего не пишется. Формат ответа тот же: `{recipe_id, code, state}`
  или `{recipes: []}`, если подходящих не осталось (например, все отсеялись
  фильтрами). Ошибки — `{"code":N,"state":"..."}`, 401 без изменений.

Миграция (`backend/recipes/migrations.py`, сама при старте recipes): в `user_preferences` колонка
`forbidden` переименовывается в `allergies`, добавляется `diets`, а `vegan` / `vegetarian` из `religions`
(и `allergies`) переносятся в `diets`. У рецептов `vegan` / `vegetarian` по-прежнему лежат в `religions`.

## Поиск по избранному (`/api/db/recipes/favorite/search`)

Сервис recipes, нужен для планировщика (выбор блюда из избранного).

```
GET /api/db/recipes/favorite/search?q=<строка>
Auth: Authorization: Bearer <access_token>

Query:
  q   string, необязательный. Что ищем: слова названия, теги по-русски, категории.
      Пустой или отсутствует -> всё избранное (как GET /api/db/recipes/favorite).

200 OK:
{
  "code": 200,
  "state": "OK",
  "recipes": [1, 7]
}
  recipes - id рецептов из избранного пользователя, по релевантности (лучшие первыми).
            Без q - в порядке GET /api/db/recipes/favorite.
            Ничего не нашлось -> "recipes": [] (200, не 404).

401 Unauthorized (нет токена или он невалидный):
{"detail": "..."}   <- как у остальных защищённых ручек

Примеры:
  ?q=борщ      -> Борщ
  ?q=лимоны    -> «Лимонный чизкейк», «Лимонная водка», потом «Домашний лимонад»
  ?q=алкоголь  -> «Алкогольный пунш», рецепты с водкой/вином/коктейлем в названии,
                  рецепты с тегом alcohol
  ?q=суп       -> все супы: «Суп ...», «Борщ», «Щи», «Том ям» (тег soup)
  ?q=борш, ?q=чизкек -> опечатки тоже находятся (ниже точных совпадений)
  ?q=чиз       -> чизкейки (поиск по началу слова, пока пользователь печатает)
  ?q=арбуз     -> рецепты с арбузом в ингредиентах (ниже всех совпадений по названию/тегам)
```

Карточки рецептов фронт берёт из своего кэша, тех, что нет, догружает через `GET /api/db/recipes/{id}`.

Как ищется (`backend/recipes/search.py`, без внешних библиотек): регистр и `ё`/`е` не важны,
слова сравниваются по основе (лимоны ~ лимонный ~ лимонная), теги рецепта (английские коды)
переведены на русский, есть словарь категорий/синонимов (суп -> борщ, щи, уха...;
алкоголь -> водка, вино, коктейль...; десерт, салат, напиток, завтрак, выпечка, мясо, рыба...).
Порядок: точное слово в названии > то же слово в другой форме > начало слова > похожий корень >
блюдо из категории > тег > опечатка в названии > подстрока > опечатка в теге >
ингредиент (самый нижний уровень: «арбуз» найдёт смузи с арбузом в составе, «лимоны» —
после всех лимонных названий ещё и «Лосось на гриле», где есть лимон; отдельного уровня опечаток для ингредиентов нет).
Несколько слов в `q`: выше те рецепты, где совпало больше слов. При равенстве — порядок избранного.

В список тегов (`vocab.TAGS`) добавлен `alcohol` (алкогольные напитки/блюда), чтобы его можно
было ставить рецептам при создании/редактировании.

## Удаление из избранного, лайков и дизлайков

Сервис recipes. Снимает реакцию текущего пользователя; сам рецепт не удаляется.
Лайк и избранное независимы: сняли одно — второе остаётся. Дизлайк при снятии
impression не трогает; в циклической ленте `GET /next` рецепт может вернуться
позже (у рекомендателя за дизлайк штраф, но не жёсткий бан).

```
DELETE /api/db/recipes/favorite/{recipe_id}
DELETE /api/db/recipes/liked/{recipe_id}
DELETE /api/db/recipes/disliked/{recipe_id}
Auth: Authorization: Bearer <access_token>

200 OK, реакция была и удалена:
{"code": 200, "state": "OK", "removed": true}

200 OK, такой реакции не было (повторный вызов, идемпотентно):
{"code": 200, "state": "OK", "removed": false}

404 Not Found (рецепта с таким id нет):
{"code": 404, "state": "Not Found"}

401 Unauthorized (нет токена или он невалидный):
{"detail": "..."}
```

Пачкой — выбранные id или весь список:

```
DELETE /api/db/recipes/favorite?ids=1,2,3
DELETE /api/db/recipes/liked?ids=1,2,3
DELETE /api/db/recipes/disliked?ids=1,2,3
DELETE /api/db/recipes/favorite          # без ids — очистить весь список
Auth: Authorization: Bearer <access_token>

Query:
  ids   необязательный. id через запятую (?ids=1,2,3) или повторно (?ids=1&ids=2).
        Не больше 1000. Не передан — удаляется весь список этой реакции.
        Пустой (?ids=) — ничего не удаляем, "recipes": [].

200 OK:
{"code": 200, "state": "OK", "recipes": [1, 3]}
  recipes — id, которые реально были удалены (для заданных ids — в том же порядке,
            без дублей; при очистке всего списка — как в GET, свежие первыми).
            Несуществующие id и те, на которых реакции не было, в список не попадают.

422 Unprocessable Entity (мусор в ids, не целое, число вне int32, больше 1000 id):
{"code": 422, "state": "Unprocessable Entity"}

401 Unauthorized:
{"detail": "..."}
```

`DELETE /api/db/recipes/{recipe_id}` по-прежнему удаляет сам рецепт (вместе с реакциями).

## Служебный аккаунт


`SERVICE_ADMIN_EMAIL` / `SERVICE_ADMIN_PASSWORD` в `.env` в корне проекта (по умолчанию `admin@gmail.com` / `admin`).
При старте auth создаётся пользователь с ролью admin (без кода с почты); если он уже есть — пароль и роль
приводятся к значениям из `.env`. Если хоть одно значение пустое — аккаунт не создаётся
(уже созданный не удаляется). После изменения: `docker compose up -d auth`.
Если сменить пароль админа через `POST /api/auth/change_pswd`, при следующем старте auth он снова
станет таким, как в `.env` — для постоянного изменения правьте `SERVICE_ADMIN_PASSWORD` там.
