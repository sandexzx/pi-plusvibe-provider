---
name: refresh-model-catalog
description: Use when adding or removing PlusVibeAPI models, refreshing the bundled snapshot in src/catalog-snapshot.ts (model list, context limits, image input, reasoning, thinking levels, ruble prices), or updating the model-related docs and tests in pi-plusvibe-provider.
---

# Refresh Model Catalog

Use this skill when the PlusVibeAPI catalog changes: new or retired models, different context
limits or image/reasoning capabilities, new thinking levels, or different ruble prices. All commands
run from the repository root.

## How the catalog is wired

Two public endpoints are merged and bundled:

- `https://plusvibeapi.ru/api/integrations/pi.models.json` — the vendor's pi model list.
  Authoritative for `id`, `name`, `reasoning`, `input`, `contextWindow`, `maxTokens`.
- `https://plusvibeapi.ru/api/catalog` — ruble prices (per million tokens) and capability metadata
  (`maker`, `caps.reasoning.levels`, `variants`). Enriches the vendor list, never overrides it.

`mergeCatalog()` in [src/catalog.ts](../../../src/catalog.ts) is the only place the two are
combined; [scripts/sync-catalog.ts](../../../scripts/sync-catalog.ts) serializes the result into
[src/catalog-snapshot.ts](../../../src/catalog-snapshot.ts) via `serializeSnapshot()`
([src/models.ts](../../../src/models.ts)), and `toProviderModels()` projects entries into pi model
definitions. At runtime [index.ts](../../../index.ts) refreshes live models and falls back to the
bundled snapshot.

## Core rules

- Do not commit, tag, push, or publish unless the user explicitly asks in the current conversation.
- `src/catalog-snapshot.ts` is generated. Never edit it by hand, and never adjust
  `SNAPSHOT_GENERATED_AT` manually.
- Prices are upstream data in rubles. Report anomalies; never retype a price into the snapshot.
- Both languages ship every user-facing document: `README.md`/`README.ru.md`,
  `docs/*.md`/`docs/*.ru.md`, `CONTRIBUTING.md`/`CONTRIBUTING.ru.md`. Update both or neither.
- This repository has no `CHANGELOG.md`. Do not add one.
- Keep the change focused: one refresh per change, no unrelated refactors. Follow
  [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## 1. Detect drift (read-only)

```sh
npx tsx .agents/skills/refresh-model-catalog/scripts/report-catalog-drift.ts
```

The report writes nothing and is safe to run first. It fetches both endpoints, merges them the same
way the extension does, and prints:

- **Drift** — added ids, removed ids, and field-level changes (name, maker, reasoning, input,
  contextWindow, maxTokens, thinking levels, each ruble price field) against the bundled snapshot.
- **Live capabilities** — priced / total, image and reasoning counts, models advertising explicit
  thinking levels, models with invalid limits, models with a zero price field.
- **Quirk review** — the maker histogram (with makers that are new since the snapshot), the ids the
  DeepSeek workaround applies to, models with no price, and models advertising explicit levels.

`--json` prints the same data as JSON for machine reading. Exit `0` means a report was produced,
including an empty or degraded one; exit `1` means fetching, parsing, or merging failed. That is not
exhaustive payload validation: malformed records are skipped and some fields get defaults.

**Stop here when the diff is empty.** If the normalized diff shows no drift, say so and stop.
Nothing to change is a valid result, and `npm run sync:catalog` would still rewrite
`SNAPSHOT_GENERATED_AT` and leave a timestamp-only diff.

The report compares *normalized* catalogs, not raw payloads. It does not prove that upstream schemas,
router reasoning behaviour, the RUB→USD rate, or billing are unchanged. A new family can also be
grouped under an existing maker (for example `Другие`), so review the added ids, not only `new makers`.

## 2. Review the drift — repo-specific risks

The report gives data, not judgements. Walk this checklist before anything writes to the snapshot;
the same checks apply to the refreshed snapshot afterwards.

- **Missing price is silent.** A model whose id has no matching `/api/catalog` variant, or whose
  price fields are absent or non-numeric, gets no `costRub`, and pi shows `$0.00`. The report lists
  those ids under *models without a price*; one field turning into `0` appears as
  `costRub.<field>: X -> 0` and lands under *models with a zero price field*. Read the raw payloads to
  tell an intended free variant from an incomplete or renamed field; report it, never invent a price.
- **Prose levels are dropped on purpose.** `explicitThinkingLevels()` keeps only pi's vocabulary
  (`minimal`…`max`); values like `thinking` or `extended thinking` mean "on/off, no selectable
  effort" and yield `undefined`. A lost level there is expected, not a regression.
- **Levels come from `caps.reasoning.levels`.** `reasoning: true` without explicit levels leaves pi
  on its provider defaults — for a non-DeepSeek model that is the intended behaviour.
- **New vendor family:** check `new makers` *and* the added ids in the report. `isDeepSeekModel()`
  ([src/catalog.ts](../../../src/catalog.ts), id or maker) decides which models the projection in
  `thinkingLevelMapForModel()` ([src/models.ts](../../../src/models.ts)) routes through
  `DEEPSEEK_THINKING_LEVEL_MAP` and `compat.thinkingFormat = "openrouter"`. If a new family shows the
  same effort quirk, measure the router (characters of `reasoning_content` per effort), extend the
  detection in `src/catalog.ts`, adjust the projection in `src/models.ts` if needed, add a regression
  test for the new id and maker, and document it in `docs/configuration.md` **and**
  `docs/configuration.ru.md`.
- **Ids can carry suffixes** such as `:free`. Detection is a regex on the id, so variants must keep
  matching after a refresh.
- **Name suffix is added at projection time.** Pi names always end with ` (PV)`
  (`MODEL_NAME_SUFFIX`); never bake the suffix into the snapshot.
- **Sanity-check price magnitudes.** A uniform jump of an order of magnitude across models usually
  means an upstream unit or currency mistake. Report it instead of patching the snapshot.

## 3. Refresh the snapshot

```sh
npm run sync:catalog
```

The generator is a backstop, not a validator. It refuses to overwrite the snapshot in two cases only:

- the merged list is empty, or
- the model count or the priced-model count falls below 80 % of the current snapshot
  (`MIN_SNAPSHOT_RATIO = 0.8`), which usually means an upstream field rename.

The ratio guard counts models that merely have a `costRub` object. If upstream renames `inputRub`
while `outputRub` survives, the model still counts as priced, the guard passes, and the input price
silently becomes `0` (see `costRubFromVariant()` in [src/catalog.ts](../../../src/catalog.ts)).
Limits, thinking levels, and capabilities are not guarded at all. `--force` bypasses the ratio
checks, never the empty-list refusal.

When the guard fires, review the drift report: if the drop is real, re-run with
`npm run sync:catalog -- --force`. Never use `--force` before understanding the reported drop.

## 4. Tests

No fixture pins the current snapshot's ids or counts, so added, retired, or repriced models normally
need no test edits. The invariants that a refresh *can* break live in:

- `tests/test-catalog.ts` → "the bundled snapshot is complete and internally consistent": more than
  50 models, non-empty unique ids, positive integer `contextWindow`/`maxTokens`, non-empty `input`,
  boolean `reasoning`, sorted by id, at least one priced model.
- `tests/test-models.ts` → DeepSeek workaround coverage of the snapshot (at least one DeepSeek
  model, `low` mapped to `medium`, `compat` set) and the ` (PV)` suffix on every model name.

The DeepSeek level assertion is unconditional. If upstream gives a DeepSeek model explicit levels
that exclude `low`, `thinkingLevelMapForModel()` correctly projects `low: null` and the test fails
although the data is right. In that case make the assertion conditional — advertised levels decide
what stays selectable, `DEEPSEEK_THINKING_LEVEL_MAP` decides the effort sent for the selectable ones
— and add a focused test for the new level set. Never push `low` back into upstream data to satisfy
a test.

Fix the data or the invariant's rationale — never weaken an assertion to make it pass. Run the new
value past the drift report before changing an expectation.

## 5. Documentation

Usually no documentation change is needed. Touch it only when user-visible behaviour changed:

- `docs/configuration.md` / `docs/configuration.ru.md` — environment variables, the RUB→USD cost
  section, the DeepSeek effort table. Both files cite concrete model ids; verify those ids still
  exist in the refreshed snapshot.
- `README.md` / `README.ru.md` — capability bullets; they carry no model counts or prices.
- `CONTRIBUTING.md` / `CONTRIBUTING.ru.md` — the file-structure table, only if files move.

## 6. Validate

```sh
npm run typecheck
npm test
git diff --check
```

When registration or credentials changed, also run the isolated Pi smoke check from
[CONTRIBUTING.md](../../../CONTRIBUTING.md):

```sh
agent_dir="$(mktemp -d)"
echo '{"packages":["'"$PWD"'"]}' > "$agent_dir/settings.json"
PI_CODING_AGENT_DIR="$agent_dir" PLUSVIBE_API_KEY=dummy pi --list-models plusvibe
```

The repository configures no linter or formatter. Match the surrounding style: double quotes, no
semicolons, ~120 columns. The drift script lives under `.agents/skills/**/*.ts`, which
`tsconfig.json` includes, so `npm run typecheck` covers it.

## 7. Report

State the before/after numbers (models, priced, models with unusable limits), the added and removed
ids, and any quirk decision you made (including every anomaly you looked at and decided not to fix).
A no-drift run stops in step 1.
