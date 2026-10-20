# Configuration

[← README](../README.md) · [Русский](configuration.ru.md)

The shell examples below use Bash/Zsh. Avoid putting real keys in commands saved to shell history. Prefer `/login` for everyday use.

## Gateway / mirror

Two named gateways are available: `main` (`https://plusvibeapi.ru/v1`) and `mirror`
(`https://gw.plusvibeapi.ru/v1`). There is no automatic failover.

The choice is saved in `~/.config/plusvibe/gateway.json`, for example:

```json
{ "gateway": "mirror" }
```

A missing, unreadable or invalid file selects `main`. For manual file edits, restart Pi.
The `/plusvibe-gateway` command toggles main ↔ mirror and saves the choice. It applies
immediately, without restarting Pi, for both Claude and other models.
`/plusvibe-balance` shows the active gateway.

Priority: non-empty `PLUSVIBE_BASE_URL` > saved gateway > `main`. Whitespace-only
values are ignored. With the environment override set, switching is refused and
custom proxies keep their existing behavior. Remove the override to use the saved choice.

Public catalog requests follow the named gateway. With a custom environment URL,
public catalogs still use `https://plusvibeapi.ru`. The offline catalog sync script
also continues to use the main host. Your key and model requests go to the selected
API gateway; only choose a custom URL you trust.

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
| `PLUSVIBE_BASE_URL` | Overrides the saved gateway. Default: `https://plusvibeapi.ru/v1`; mirror: `https://gw.plusvibeapi.ru/v1`. |
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

Claude models use pi's native `anthropic-messages` implementation and `/v1/messages`.
Pi enables extended thinking with `thinking: {type: "enabled", budget_tokens: …}`;
`/thinking off` sends `thinking: {type: "disabled"}`. The budget is managed by pi.
Catalog `thinkingLevels` effort mappings are not applied to Claude's native budgets.
The extension removes the trailing `/v1` from the model's base URL because the Anthropic
SDK adds `/v1/messages` itself; mirror URLs and gateway path prefixes are preserved.
The same credentials and `/login` work for both protocols.

Visible thinking still depends on the upstream response. In manual HTTP/SSE checks,
Haiku 5.5 and Sonnet 5.5 returned empty `thinking_delta` text even with native thinking
enabled. Sonnet was also checked through pi's native handler with the same result.
These were manual checks, not the mocked regression tests in `tests/test-anthropic.ts`.
To reproduce, POST to `/v1/messages` with `stream: true`, `max_tokens: 2048`,
`thinking: {type: "enabled", budget_tokens: 1024}`, and model `claude-sonnet-5.5`
(or `claude-haiku-5.5`), plus a user message, for example
`messages: [{role: "user", content: "Find the smallest positive n: n mod 7 = 3, n mod 11 = 5, n mod 13 = 7. Verify."}]`.
Authenticate with `x-api-key` and set
`anthropic-version: 2023-06-01`. Inspect the `thinking_delta` events in the SSE response.
Switching protocols cannot recover reasoning text that the server does not send.
See the vendor's
[reasoning documentation](https://plusvibeapi.ru/docs/reasoning).

Other models use Chat Completions. Pi normally passes the reasoning level in the
`reasoning_effort` field. On this router, DeepSeek models
behave unusually: the values `none`, `minimal` and `low` **turn reasoning off**, while `medium`,
`high`, `xhigh` and `max` turn it on. The router ignores DeepSeek's native
`thinking: {type: …}` field.

Because the Pi default level is `low`, DeepSeek models silently answered without a reasoning
block. The extension therefore, for DeepSeek models:

- sends reasoning in the `reasoning: {effort: …}` format (`compat.thinkingFormat = "openrouter"`);
- replaces `minimal` and `low` with `medium`;
- for the `off` level, sends `effort: none`, which really disables reasoning.

Result: any level except `off` produces a reasoning block, `off` disables it.
Other non-Claude models behave as before (for example, `openai/gpt-5.6-luna` with `low` produces
less reasoning rather than none).
