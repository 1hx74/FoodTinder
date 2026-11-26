"""Поиск по избранному (GET /api/db/recipes/favorite/search).

Без внешних зависимостей: свой маленький «стеммер» для русского языка,
словарь «тег -> русские слова» и словарь категорий/синонимов.
Избранное у пользователя небольшое, поэтому ищем в Python по уже загруженным
(id, title, tags), а не в SQL.

Как ищем одно слово запроса (токен) в рецепте, баллы по убыванию:
  100  слово названия совпадает с токеном          «борщ»     -> «Борщ»
   80  то же слово в другой форме (по основе)       «лимоны»   -> «Лимонный чизкейк»
   60  токен — начало слова названия (поиск на ходу) «чизк»     -> «Чизкейк Нью-Йорк»
   55  слово названия похожего корня (менее надёжно) «лимоны»   -> «Домашний лимонад»
   50  слово названия из категории/синонимов токена «алкоголь» -> «Лимонная водка»,
                                                    «суп»      -> «Борщ», «Щи»
   45  тег рецепта по-русски (или код тега)         «суп»      -> тег soup,
                                                    «алкоголь» -> тег alcohol
   35  опечатка в слове названия                    «борш»     -> «Борщ», «чизкек» -> «Чизкейк»
   32  категория/синонимы по слову с опечаткой      «дисерт»   -> «Эклеры», «Тирамису»
   30  токен внутри слова названия (от 3 букв)       «кейк»     -> «Чизкейк»
   25  тег по слову с опечаткой                     «завтрк»   -> тег breakfast
   20  ингредиент рецепта (по основе, без опечаток; только если по названию,
       тегам и категориям токен не совпал)          «арбуз»    -> смузи с арбузом,
                                                    «лимоны»   -> «Лосось на гриле» (лимон)
Опечатки (Левенштейн, 1 ошибка, у слов от 9 букв — 2, первая буква должна
совпасть) — самый нижний уровень: точные совпадения всегда выше. Если ничего
не прошло даже по опечаткам — пустой список, а не всё подряд.
Берётся лучший балл токена по рецепту. Рецепт попадает в выдачу, если совпал
хоть один токен. Сортировка: больше совпавших токенов -> больше сумма баллов ->
порядок избранного (как в GET /favorite: недавно добавленные первыми).
"""

import re
from collections.abc import Iterable, Sequence

from vocab import TAGS

MAX_QUERY_LEN = 200

# ---------- нормализация и стемминг ----------

_WORD_RE = re.compile(r"[0-9a-zа-я]+")

# окончания (прилагательные, существительные, немного глагольных); длинные первыми
_ENDINGS = sorted(
    {
        # прилагательные / причастия
        "ейшими", "ейшего", "ейшему", "ейшая", "ейший", "ейшее", "ейшие",
        "ого", "его", "ому", "ему", "ыми", "ими",
        "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ой", "ую", "юю",
        "ых", "их", "ым", "им",
        # существительные
        "иями", "ями", "ами", "иях", "ах", "ях", "ов", "ев", "ей", "ам", "ям",
        "ом", "ем", "ия", "ья", "ье", "ию", "ью", "ии",
        "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й",
        # глаголы (на случай «запечь/запечённый» и т.п. — грубо)
        "ться", "тся", "ть",
    },
    key=len,
    reverse=True,
)

_MIN_STEM = 3          # короче основу не обрезаем
_MIN_COMMON = 4        # минимум общих букв, чтобы считать слова однокоренными


def normalize(text: str) -> str:
    return text.lower().replace("ё", "е")


def words(text: str) -> list[str]:
    """Нормализованные слова строки (дефис, пробелы, знаки — разделители)."""
    return _WORD_RE.findall(normalize(text))


def stem(word: str) -> str:
    """Грубая основа слова: срезаем одно самое длинное подходящее окончание,
    оставляя не меньше _MIN_STEM букв. Английские слова не трогаем."""
    if not re.search("[а-я]", word):
        return word
    for end in _ENDINGS:
        if word.endswith(end) and len(word) - len(end) >= _MIN_STEM:
            return word[: -len(end)]
    return word


def _common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


# суффиксы прилагательных после основы существительного: лимон-н(ый), рис-ов(ый),
# алкогол-ьн(ый), шоколад-н(ый), итальян-ск(ий)
_ADJ_TAILS = {"н", "нн", "ьн", "ов", "ев", "ск", "еск", "чн", "ичн", "ян", "ан"}

STRONG, WEAK = 2, 1


def root_match(a: str, b: str) -> int:
    """Насколько a и b однокоренные (a, b — уже нормализованные слова):
    STRONG — одна основа или основа + суффикс прилагательного:
             лимоны ~ лимонный ~ лимонная, алкоголь ~ алкогольный, суп ~ супы, рис ~ рисовый;
    WEAK   — похоже, но менее надёжно: лимон ~ лимонад, курица ~ куриный, молоко ~ молочный;
    0      — разные слова (вино / винегрет, ром / ромашковый)."""
    if a == b:
        return STRONG
    sa, sb = stem(a), stem(b)
    if sa == sb:
        return STRONG
    short, long_ = sorted((sa, sb), key=len)
    tail = long_[len(short):]
    if len(short) >= _MIN_STEM and long_.startswith(short) and len(tail) <= (3 if len(short) >= 4 else 2):
        return STRONG if tail in _ADJ_TAILS else WEAK
    # курин / куриц, молок / молочн: расходятся в последних буквах основы
    common = _common_prefix(sa, sb)
    if common >= _MIN_COMMON and common >= len(short) - 1 and len(long_) - common <= 2:
        return WEAK
    return 0


def same_root(a: str, b: str) -> bool:
    return root_match(a, b) > 0


def _levenshtein(a: str, b: str, limit: int) -> int:
    """Расстояние Левенштейна; как только превысили limit — возвращаем limit + 1."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def typo_match(a: str, b: str) -> bool:
    """Похоже на опечатку: борш ~ борщ, чизкек ~ чизкейк, дисерт ~ десерт.
    Слова от 4 букв, первая буква совпадает (иначе слишком много мусора),
    допускается 1 ошибка, у слов от 9 букв — 2. Сравниваем и слова, и основы."""
    if len(a) < 4 or len(b) < 4 or a[0] != b[0]:
        return False
    limit = 2 if min(len(a), len(b)) >= 9 else 1
    if _levenshtein(a, b, limit) <= limit:
        return True
    sa, sb = stem(a), stem(b)
    return len(sa) >= 4 and len(sb) >= 4 and _levenshtein(sa, sb, limit) <= limit


# ---------- словари ----------

# тег рецепта -> русские слова (в любой форме, сравниваются по основе)
TAG_WORDS: dict[str, tuple[str, ...]] = {
    # тип блюда
    "breakfast": ("завтрак",),
    "soup": ("суп", "супчик", "первое"),
    "salad": ("салат",),
    "main": ("горячее", "второе", "основное", "обед", "ужин"),
    "side": ("гарнир",),
    "dessert": ("десерт",),
    "baking": ("выпечка", "выпечь", "печеное"),
    "drink": ("напиток", "питье", "попить"),
    "alcohol": ("алкоголь", "алкогольный", "спиртное", "выпивка", "градус"),
    # основной ингредиент
    "meat": ("мясо", "мясной"),
    "chicken": ("курица", "куриный", "птица"),
    "fish": ("рыба", "рыбный"),
    "seafood": ("морепродукты", "креветка", "кальмар", "мидия"),
    "pasta": ("паста", "макароны", "спагетти"),
    "rice": ("рис", "рисовый"),
    "eggs": ("яйцо", "яйца", "яичный"),
    "dairy": ("молочное", "молоко", "сыр", "творог", "сливки"),
    "vegetables": ("овощи", "овощной"),
    "fruit": ("фрукты", "фруктовый", "ягоды"),
    "chocolate": ("шоколад", "шоколадный", "какао"),
    # кухня
    "russian": ("русский", "русская"),
    "italian": ("итальянский", "италия"),
    "asian": ("азиатский", "азия", "китайский", "японский", "тайский"),
    "mediterranean": ("средиземноморский",),
    "american": ("американский", "америка"),
    "french": ("французский", "франция"),
    # характер
    "quick": ("быстро", "быстрый"),
    "easy": ("просто", "простой", "легкий", "легко"),
    "spicy": ("острый", "остро", "пикантный"),
    "sweet": ("сладкий", "сладкое", "сладости"),
    "healthy": ("полезный", "полезно", "здоровый", "пп"),
    "refreshing": ("освежающий", "прохладный"),
    "comfort": ("уютный", "сытный", "домашний"),
}

# категория / слово запроса -> слова, которые могут стоять в названии блюда.
# Ключ сравнивается с токеном по основе, значения — со словами названия.
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "суп": ("борщ", "щи", "солянка", "уха", "том", "рассольник", "окрошка",
            "бульон", "харчо", "лагман", "гаспачо", "свекольник", "крем", "рамен", "фо"),
    "салат": ("оливье", "цезарь", "винегрет", "капрезе", "шуба", "мимоза"),
    "десерт": ("торт", "пирожное", "чизкейк", "тирамису", "эклер", "мороженое",
               "пудинг", "брауни", "панакота", "мусс", "кекс", "маффин", "печенье",
               "суфле", "безе", "макарон", "трюфель", "конфета", "пирог", "штрудель"),
    "сладкое": ("торт", "пирожное", "чизкейк", "тирамису", "эклер", "мороженое",
                "шоколад", "конфета", "пирог", "блин", "печенье", "кекс"),
    "выпечка": ("пирог", "пирожок", "хлеб", "булочка", "блин", "оладьи", "эклер",
                "чизкейк", "кекс", "маффин", "круассан", "пицца", "печенье", "торт",
                "ватрушка", "штрудель", "лаваш"),
    "напиток": ("лимонад", "смузи", "сок", "чай", "кофе", "какао", "коктейль",
                "морс", "компот", "кисель", "пунш", "латте", "капучино", "шоколад"),
    "алкоголь": ("водка", "вино", "ром", "пиво", "виски", "коньяк", "текила", "джин",
                 "ликер", "коктейль", "пунш", "глинтвейн", "сидр", "шампанское",
                 "мартини", "сангрия", "настойка", "наливка", "самогон", "бренди"),
    "завтрак": ("омлет", "яичница", "блин", "оладьи", "сырники", "каша", "гренки",
                "тост", "смузи", "мюсли", "гранола"),
    "мясо": ("говядина", "свинина", "баранина", "телятина", "бекон", "фарш", "стейк",
             "котлета", "шашлык", "гуляш", "плов", "карбонара"),
    "рыба": ("лосось", "семга", "форель", "тунец", "треска", "сельдь", "скумбрия",
             "судак", "минтай", "дорадо", "сибас"),
    "морепродукты": ("креветка", "кальмар", "мидия", "краб", "осьминог", "гребешок",
                     "устрица", "том"),
    "паста": ("спагетти", "макароны", "карбонара", "лазанья", "феттучини", "пенне",
              "болоньезе", "лапша"),
    "гарнир": ("картофель", "картошка", "пюре", "рис", "гречка", "макароны"),
    "курица": ("куриный", "цыпленок", "плов", "терияки", "наггетсы"),
    # синонимы отдельных продуктов
    "картофель": ("картошка", "пюре", "драники", "фри"),
    "картошка": ("картофель", "картофельный", "пюре", "драники", "фри"),
    "лимон": ("лимонад",),
    "креветка": ("том",),
}

# все теги из vocab.TAGS должны быть переведены (проверяется и в тестах)
_missing = set(TAGS) - set(TAG_WORDS)
assert not _missing, f"нет русских слов для тегов: {sorted(_missing)}"

_TAG_WORDS_NORM = {
    tag: tuple(dict.fromkeys(w for phrase in ws for w in words(phrase)))
    for tag, ws in TAG_WORDS.items()
}
_CATEGORY_NORM = {
    normalize(k): tuple(dict.fromkeys(w for phrase in v for w in words(phrase)))
    for k, v in CATEGORY_WORDS.items()
}

# ---------- баллы ----------

SCORE_TITLE_EXACT = 100
SCORE_TITLE_ROOT = 80
SCORE_TITLE_PREFIX = 60
SCORE_TITLE_WEAK_ROOT = 55
SCORE_CATEGORY = 50
SCORE_TAG = 45
SCORE_TITLE_TYPO = 35
SCORE_CATEGORY_TYPO = 32
SCORE_TAG_TYPO = 25
SCORE_INGREDIENT = 20
SCORE_TITLE_SUBSTR = 30


def _category_words(token: str, match=same_root) -> tuple[str, ...]:
    """Слова категорий, к которым относится токен (суп/супы/супчик -> суп; и т.д.).
    Плюс категории тегов: если токен — русское слово тега, берём категории
    с ключами, однокоренными словам этого тега.
    match=typo_match — то же, но для слова с опечаткой."""
    keys = {k for k in _CATEGORY_NORM if match(token, k)}
    for tag_words in _TAG_WORDS_NORM.values():
        if any(match(token, w) for w in tag_words):
            keys |= {k for k in _CATEGORY_NORM if any(same_root(k, w) for w in tag_words)}
    out: list[str] = []
    for k in keys:
        out.extend(_CATEGORY_NORM[k])
    return tuple(dict.fromkeys(out))


def _token_score(token: str, title_words: list[str], tags: Iterable[str],
                 cat_words: tuple[str, ...], typo_cat_words: tuple[str, ...],
                 typo_tags: bool = True) -> int:
    best = 0
    for w in title_words:
        if w == token:
            return SCORE_TITLE_EXACT
        m = root_match(token, w)
        if m == STRONG:
            best = max(best, SCORE_TITLE_ROOT)
        elif len(token) >= 2 and w.startswith(token):
            best = max(best, SCORE_TITLE_PREFIX)
        elif m == WEAK:
            best = max(best, SCORE_TITLE_WEAK_ROOT)
        elif len(token) >= 3 and token in w:
            best = max(best, SCORE_TITLE_SUBSTR)
    if best >= SCORE_CATEGORY:
        return best
    if cat_words and any(root_match(c, w) == STRONG for c in cat_words for w in title_words):
        return SCORE_CATEGORY
    for tag in tags:
        if tag == token or any(same_root(token, w) for w in _TAG_WORDS_NORM.get(tag, ())):
            return SCORE_TAG
    # ---- опечатки: только если точнее ничего не нашлось ----
    if best >= SCORE_TITLE_TYPO:
        return best
    if any(typo_match(token, w) for w in title_words):
        return SCORE_TITLE_TYPO
    if typo_cat_words and any(
        root_match(c, w) == STRONG for c in typo_cat_words for w in title_words
    ):
        return SCORE_CATEGORY_TYPO
    if best:
        return best
    if typo_tags:
        for tag in tags:
            if any(typo_match(token, w) for w in _TAG_WORDS_NORM.get(tag, ())):
                return SCORE_TAG_TYPO
    return 0


def _is_tag_word(token: str) -> bool:
    return token in _TAG_WORDS_NORM or any(
        same_root(token, w) for ws in _TAG_WORDS_NORM.values() for w in ws
    )


def _ingredient_score(token: str, ingredient_words: list[str]) -> int:
    """Самый нижний уровень: слово из названия ингредиента (та же основа,
    без опечаток — их по ингредиентам слишком много мусора)."""
    if any(root_match(token, w) for w in ingredient_words):
        return SCORE_INGREDIENT
    return 0


def search_recipes(query: str | None, recipes: Sequence[tuple]) -> list[int]:
    """recipes — (id, title, tags) или (id, title, tags, ingredient_names)
    в порядке избранного. Возвращает id по релевантности.
    Пустой запрос (или без букв/цифр) — все id в исходном порядке."""
    tokens = list(dict.fromkeys(words((query or "")[:MAX_QUERY_LEN])))
    if not tokens:
        return [r[0] for r in recipes]

    cats = {t: _category_words(t) for t in tokens}
    # слово, которое и так есть в словарях (выпечка), не «исправляем» в похожее (выпивка)
    known = {t for t in tokens if cats[t] or _is_tag_word(t)}
    typo_cats = {t: () if t in known else _category_words(t, typo_match) for t in tokens}
    scored: list[tuple[int, int, int, int]] = []
    for pos, (rid, title, tags, *rest) in enumerate(recipes):
        title_words = words(title or "")
        tags = list(tags or [])
        ingredient_words = [w for name in (rest[0] if rest else ()) or () for w in words(name)]
        scores = [
            _token_score(t, title_words, tags, cats[t], typo_cats[t], t not in known)
            or _ingredient_score(t, ingredient_words)
            for t in tokens
        ]
        matched = sum(1 for s in scores if s > 0)
        if matched:
            scored.append((-matched, -sum(scores), pos, rid))
    scored.sort()
    return [rid for *_, rid in scored]
