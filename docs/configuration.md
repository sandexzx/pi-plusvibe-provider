# Configuration

[← README](../README.md) · [Русский](configuration.ru.md)

The shell examples below use Bash/Zsh. Avoid putting real keys in commands saved to shell history. Prefer `/login` for everyday use.

## API key

Keys start with `sk-pv-` and are created in the dashboard at https://plusvibeapi.ru/.
Use any of the following methods:

| Method | How | When it fits |
| --- | --- | --- |
| Environment variable | `export PLUSVIBE_API_KEY='sk-pv-…'` in `~/.bashrc`, then restart Pi | Continuous use |
| Key file | `mkdir -p ~/.config/plusvibe && (umask 077; printf '%s' 'sk-pv-…' > ~/.config/plusvibe/key) && chmod 600 ~/.config/plusvibe/key` | The key does not enter the environment; `models.json` is not needed |
| `/login` | `/login` → `PlusVibeAPI` → paste the key | Persistent setup; the key is stored in `auth.json` |
| CLI flag | `pi --provider plusvibe --model anthropic/claude-opus-5 --api-key sk-pv-…` | A single run |

The extension reads the key file itself (by default `~/.config/plusvibe/key`; another path is set
with `PLUSVIBE_API_KEY_FILE`). Mode `600` is recommended so that only the file owner can read and write the key file. The extension does not check file permissions.

Priority order: `--api-key` → the key from `auth.json` (after `/login`) → `PLUSVIBE_API_KEY` → the
key file.
Note: once a key is stored through `/login`, it overrides both the environment variable and the
file. Run `/logout` to change the key (or pass `--api-key` for a single run).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PLUSVIBE_API_KEY` | API key (`sk-pv-…`). |
| `PLUSVIBE_API_KEY_FILE` | Path to the key file. Defaults to `~/.config/plusvibe/key`. |
| `PLUSVIBE_BASE_URL` | An alternative gateway address; defaults to `https://plusvibeapi.ru/v1`. Mirror: `https://gw.plusvibeapi.ru/v1`. |
| `PLUSVIBE_RUB_PER_USD` | Manual ruble rate. When unset, the rate is fetched from the network (see below). `0` or `off` disables cost estimation (Pi may show `$0`). |
| `PLUSVIBE_CACHE_DIR` | Directory for the rate file. Defaults to `$XDG_CACHE_HOME/pi-plusvibe-provider` or `~/.cache/pi-plusvibe-provider`. |

> [!WARNING]
> Set `PLUSVIBE_BASE_URL` only to a gateway you trust. It receives your API key and request content.

### About cost

The provider catalog publishes prices **in rubles only** per million tokens, while Pi shows costs
in dollars. The extension therefore fetches the official ruble rate every 12 hours and converts
the prices.

The rate is read from the following sources in order (all without a key):

1. `https://www.cbr-xml-daily.ru/daily_json.js` — a JSON mirror of the CBR data;
2. `https://www.cbr.ru/scripts/XML_daily.asp` — the original CBR XML feed;
3. `https://open.er-api.com/v6/latest/USD` — a fallback source when the CBR is unreachable.

The rate is saved to a file (`~/.cache/pi-plusvibe-provider/usd-rate.json`). When the network is
unavailable, the saved rate is used — but not older than 7 days: a stale rate is not used and the
costs are shown as `$0` until a request succeeds. The file is written through a temporary file and
`rename`, so parallel Pi instances do not corrupt it.

Priority order: the `PLUSVIBE_RUB_PER_USD` value → the saved rate → `0` (no cost estimate).
The CBR rate is daily, so the estimate in the Pi UI is approximate. Exact amounts are in the
dashboard or in `/plusvibe-balance`.

If you do not need the rate, set `PLUSVIBE_RUB_PER_USD=0`. For a custom rate, set a number, for
example `export PLUSVIBE_RUB_PER_USD=85`.

The rate sources require attribution: [cbr-xml-daily.ru](https://www.cbr-xml-daily.ru/),
[Bank of Russia](https://www.cbr.ru/development/SXML/),
[exchangerate-api.com](https://www.exchangerate-api.com/docs/free).

### About the reasoning level

Pi passes the reasoning level in the `reasoning_effort` field. On this router, DeepSeek models
behave unusually: the values `none`, `minimal` and `low` **turn reasoning off**, while `medium`,
`high`, `xhigh` and `max` turn it on. The router ignores DeepSeek's native
`thinking: {type: …}` field.

Because the Pi default level is `low`, DeepSeek models silently answered without a reasoning
block. The extension therefore, for DeepSeek models:

- sends reasoning in the `reasoning: {effort: …}` format (`compat.thinkingFormat = "openrouter"`);
- replaces `minimal` and `low` with `medium`;
- for the `off` level, sends `effort: none`, which really disables reasoning.

Result: any level except `off` produces a reasoning block, `off` disables it.
Models from other vendors behave as before (for example, `openai/gpt-5.6-luna` with `low` produces
less reasoning rather than none).
