# Contributing

[← README](README.md) · [Русский](CONTRIBUTING.ru.md)

## Local setup

```bash
git clone https://github.com/sandexzx/pi-plusvibe-provider.git
cd pi-plusvibe-provider
npm install
pi install .
```

Restart Pi after registering the local package.

## Checks

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
| `src/gateway.ts` | Persistent main/mirror choice, environment precedence and catalog origins. |
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
agent_dir="$(mktemp -d)"
echo '{"packages":["'"$PWD"'"]}' > "$agent_dir/settings.json"
PI_CODING_AGENT_DIR="$agent_dir" PLUSVIBE_API_KEY=dummy pi --list-models plusvibe
```
