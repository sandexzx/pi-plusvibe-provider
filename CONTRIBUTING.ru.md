# Разработка

[← README](README.ru.md) · [English](CONTRIBUTING.md)

## Локальная установка

```bash
git clone https://github.com/sandexzx/pi-plusvibe-provider.git
cd pi-plusvibe-provider
npm install
pi install .
```

Перезапустите Pi после подключения локального пакета.

## Проверки

```bash
npm install          # зависимости для разработки
npm run typecheck    # tsc --noEmit
npm test             # typecheck + все тесты
npm run sync:catalog # обновить src/catalog-snapshot.ts из сети
```

Структура:

| Файл | Что делает |
| --- | --- |
| `index.ts` | Регистрация провайдера, команда `/plusvibe-balance`, обновление каталога. |
| `src/catalog.ts` | Чистая логика: слияние каталогов, уровни рассуждений, конвертация цен. Без ввода-вывода. |
| `src/api.ts` | HTTP-запросы (модели, каталог, баланс) с таймаутами. |
| `src/api-key.ts` | Разбор и нормализация ключа, маскирование секретов в чужих сообщениях об ошибках. |
| `src/models.ts` | Преобразование записей каталога в определения моделей Pi. |
| `src/gateway.ts` | Сохранение выбора шлюза, приоритет окружения и адреса каталога. |
| `src/rate.ts` | Автоматический курс рубля: источники ЦБ, кеш, приоритеты. |
| `src/balance.ts` | Форматирование ответа `/v1/balance`. |
| `src/oauth.ts` | Поток `/login` (ввод и проверка ключа). |
| `src/catalog-snapshot.ts` | Сгенерированный снимок каталога. Правки вручную не нужны. |
| `scripts/sync-catalog.ts` | Генератор снимка. |
| `tests/` | Тесты на `node:assert` + `tsx`, без сети. |

После изменения `src/` выполните `npm test`. Сетевые тесты не требуются: HTTP подменяется
фиктивными `fetch`.

Проверка на изолированной конфигурации Pi (не трогает ваши настройки):

```bash
agent_dir="$(mktemp -d)"
echo '{"packages":["'"$PWD"'"]}' > "$agent_dir/settings.json"
PI_CODING_AGENT_DIR="$agent_dir" PLUSVIBE_API_KEY=dummy pi --list-models plusvibe
```
