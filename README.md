# pi-plusvibe-provider

[PlusVibeAPI](https://plusvibeapi.ru/docs) (gateway `plusvibeapi.ru`) provider for
[Pi](https://github.com/earendil-works/pi).
PlusVibeAPI is an OpenAI-compatible router, so this extension does not implement its own
protocol: it hands the work to Pi's built-in `openai-completions` implementation and adds only
the endpoint, the authorization and the model catalog.

> Russian version of this document: [README.ru.md](./README.ru.md).

> **Unofficial extension.** This project is not affiliated with, endorsed by, or supported by the
> PlusVibeAPI operator. Every user connects a personal API key. A shared-key built-in proxy or
> reselling access is prohibited by the operator's public offer.

## Status and service terms

This is an unofficial, independent client extension for PlusVibeAPI. It is not affiliated with,
endorsed by, or supported by the PlusVibeAPI operator. "PlusVibeAPI" and "PlusVibe" are used only
to identify the service this extension integrates with. Any rights in these names remain with
their respective holders.

Each user must obtain and use their own API key. This package does not include a shared key, does
not operate a proxy, and does not provide access through the maintainer's account.

Use of PlusVibeAPI is subject to the operator's
[terms of service](https://plusvibeapi.ru/legal/terms). The MIT license applies to this project's
code; it does not grant rights to the service, to operator-owned materials, or to third-party
model outputs.

The operator's terms prohibit sharing or reselling access through its keys without a separate
written agreement. Do not bypass access controls or service limits.

## What you get

- 60 models (Anthropic, OpenAI, Google, DeepSeek, Qwen, GLM, Grok, MiniMax, Moonshot and others)
  with correct `contextWindow`, `maxTokens`, image input and reasoning support.
- Automatic reasoning-level mapping (`thinkingLevelMap`) for models whose catalog publishes
  explicit levels (`low`/`medium`/`high`/…). Other models use the Pi defaults.
- `/login` — a key entry wizard that verifies the key with `GET /v1/models`.
- `/plusvibe-balance` — the account balance (`GET /v1/balance`) and the current ruble rate.
- The ruble rate is fetched automatically (the daily CBR rate) and converts model prices into
  dollars for Pi.
- Live catalog refresh from the provider's public endpoints; when the network is unavailable, the
  snapshot embedded into the extension is used.

## Installation

1. Clone the repository and install the dependencies (they are needed for development only; the
   extension itself runs from source through Pi):

   ```bash
   git clone <repo> ~/sandbox/pi-plusvibe-provider
   cd ~/sandbox/pi-plusvibe-provider && npm install
   ```

2. Add the path to the `packages` list in `~/.pi/agent/settings.json`:

   ```json
   {
     "packages": ["~/sandbox/pi-plusvibe-provider"]
   }
   ```

   An absolute path and a path relative to `~/.pi/agent` work the same way.

3. Restart Pi and pick a model with `/model` → `plusvibe`.

## API key

Keys start with `sk-pv-` and are created in the dashboard at https://plusvibeapi.ru/.
Use any of the following methods:

| Method | How | When it fits |
| --- | --- | --- |
| Environment variable | `export PLUSVIBE_API_KEY='sk-pv-…'` in `~/.bashrc`, then restart Pi | Continuous use |
| Key file | `printf '%s' 'sk-pv-…' > ~/.config/plusvibe/key && chmod 600 ~/.config/plusvibe/key` | The key does not enter the environment; `models.json` is not needed |
| `/login` | `/login` → `PlusVibeAPI` → paste the key | One-off setup; the key is stored in `auth.json` |
| CLI flag | `pi --provider plusvibe --model anthropic/claude-opus-5 --api-key sk-pv-…` | A single run |

The extension reads the key file itself (by default `~/.config/plusvibe/key`; another path is set
with `PLUSVIBE_API_KEY_FILE`). Mode `600` is required.

Priority order: `--api-key` → the key from `auth.json` (after `/login`) → `PLUSVIBE_API_KEY` → the
key file.
Note: once a key is stored through `/login`, it overrides both the environment variable and the
file. Run `/logout` to change the key (or pass `--api-key` for a single run).

## Commands

- `/model` — model picker (60 models).
- `/thinking` — reasoning level. For models with explicit levels, unsupported values are hidden;
  Pi itself clamps the requested level to the nearest supported one.
- `/plusvibe-balance` — account balance.
- `/login` — connect a key.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PLUSVIBE_API_KEY` | API key (`sk-pv-…`). |
| `PLUSVIBE_API_KEY_FILE` | Path to the key file. Defaults to `~/.config/plusvibe/key`. |
| `PLUSVIBE_BASE_URL` | An alternative gateway address; defaults to `https://plusvibeapi.ru/v1`. Mirror: `https://gw.plusvibeapi.ru/v1`. |
| `PLUSVIBE_RUB_PER_USD` | Manual ruble rate. When unset, the rate is fetched from the network (see below). `0` or `off` disables cost display in the UI. |
| `PLUSVIBE_CACHE_DIR` | Directory for the rate file. Defaults to `$XDG_CACHE_HOME/pi-plusvibe-provider` or `~/.cache/pi-plusvibe-provider`. |

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

Priority order: the `PLUSVIBE_RUB_PER_USD` value → the saved rate → `0` (costs hidden).
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

## Development

```bash
npm install          # development dependencies
npm run typecheck    # tsc --noEmit
npm test             # typecheck + all tests
npm run sync:catalog # refresh src/catalog-snapshot.ts from the network
```

Structure:

| File | Purpose |
| --- | --- |
| `index.ts` | Provider registration, the `/plusvibe-balance` command, catalog refresh. |
| `src/catalog.ts` | Pure logic: catalog merging, reasoning levels, price conversion. No I/O. |
| `src/api.ts` | HTTP requests (models, catalog, balance) with timeouts. |
| `src/api-key.ts` | Key parsing and normalization, secret masking in third-party error messages. |
| `src/models.ts` | Conversion of catalog entries into Pi model definitions. |
| `src/rate.ts` | Automatic ruble rate: CBR sources, cache, priorities. |
| `src/balance.ts` | Formatting of the `/v1/balance` response. |
| `src/oauth.ts` | The `/login` flow (key entry and verification). |
| `src/catalog-snapshot.ts` | Generated catalog snapshot. Manual edits are not needed. |
| `scripts/sync-catalog.ts` | Snapshot generator. |
| `tests/` | Tests on `node:assert` + `tsx`, no network. |

After changing `src/`, run `npm test`. Network tests are not required: HTTP is replaced with fake
`fetch` implementations.

Check against an isolated Pi configuration (does not touch your settings):

```bash
mkdir -p /tmp/pv-agent
echo '{"packages":["'"$PWD"'"]}' > /tmp/pv-agent/settings.json
PI_CODING_AGENT_DIR=/tmp/pv-agent PLUSVIBE_API_KEY=dummy pi --list-models plusvibe
```

## Limitations

- Chat models only. Embeddings, images, video, search and ASR are not connected.
- Dollar prices are approximate: the provider publishes rubles and the conversion uses the daily
  CBR rate (see above).
- A model added by the operator after a release appears only after the snapshot is refreshed
  (`npm run sync:catalog`) — or immediately in the current session when a network refresh is
  available.

## Data and privacy

Requests are sent from your machine to the configured API gateway. When you use PlusVibeAPI, the
operator forwards request content to model providers outside Russia, including providers in the
USA, China and the EU, as described in its terms.

Request content may include prompts, conversation history, source code, file contents, images and
tool results supplied by Pi. Review the content before you send it.

The operator's terms prohibit submitting personal data. Do not submit personal data about yourself
or about other people. This extension does not automatically detect or anonymize personal data.
Consent alone does not override the operator's prohibition.

Do not submit credentials, confidential information or other content unless you are authorized to
disclose it to the gateway and to the relevant model providers. Where applicable, users and
organizations must assess their own data-protection, localization and cross-border-transfer
obligations (in particular art. 12 and part 5 of art. 18 of Federal Law No. 152-FZ).

This extension does not operate a server and does not collect telemetry for its maintainer. It
makes network requests for model metadata and, unless disabled, for exchange rates. Those services
can receive ordinary connection metadata, such as your IP address. This statement describes this
extension only, not every network request of the Pi process as a whole.

Your API key is sent to the configured gateway. Set `PLUSVIBE_BASE_URL` only to an endpoint you
trust: another address can receive both the key and the request content. Do not post API keys or
unredacted logs in public issues.

## License and acknowledgments

This project's code is licensed under the [MIT License](./LICENSE).

This is an independent implementation inspired by
[pi-commandcode-provider](https://github.com/patlux/pi-commandcode-provider)
(Copyright (c) 2025 Pat Woz), including its provider-registration and credential-handling patterns.
Its copyright notice is retained as upstream attribution. The test harness and the tests were
independently written for this project.

This acknowledgment does not imply affiliation with or endorsement by the upstream project's
maintainers. This project is not affiliated with, endorsed by, or supported by the PlusVibeAPI
operator either.
