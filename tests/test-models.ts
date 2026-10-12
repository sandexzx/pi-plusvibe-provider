import assert from "node:assert/strict"

import { SNAPSHOT_MODELS } from "../src/catalog-snapshot.ts"
import { ZERO_COST } from "../src/catalog.ts"
import {
  ANTHROPIC_API,
  anthropicBaseUrl,
  isAnthropicModel,
  FALLBACK_CONTEXT_WINDOW,
  FALLBACK_MAX_TOKENS,
  MODEL_NAME_SUFFIX,
  PROVIDER_API,
  modelOptionsFromEnv,
  serializeSnapshot,
  toProviderModels,
} from "../src/models.ts"
import type { CatalogModel } from "../src/catalog.ts"
import { run, test } from "./helpers.ts"

const SAMPLE: CatalogModel[] = [
  {
    id: "vendor/with-cost",
    name: "With Cost",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 32000,
    costRub: { input: 100, output: 500, cacheRead: 25, cacheWrite: 200 },
    thinkingLevels: ["low", "high"],
  },
  {
    id: "vendor/no-cost",
    name: "No Cost",
    reasoning: false,
    input: ["text"],
    contextWindow: 0,
    maxTokens: 0,
  },
]

test("toProviderModels disables cost when no ruble rate is configured", () => {
  const models = toProviderModels(SAMPLE, { rubPerUsd: 0 })
  assert.equal(models.length, 2)
  assert.deepEqual(models[0].cost, ZERO_COST)
  assert.deepEqual(models[1].cost, ZERO_COST)
})

test("toProviderModels converts ruble rates when a rate is configured", () => {
  const [model] = toProviderModels(SAMPLE, { rubPerUsd: 100 })
  assert.deepEqual(model.cost, { input: 1, output: 5, cacheRead: 0.25, cacheWrite: 2 })
})

test("toProviderModels falls back to safe limits for malformed entries", () => {
  const [, model] = toProviderModels(SAMPLE, { rubPerUsd: 100 })
  assert.equal(model.contextWindow, FALLBACK_CONTEXT_WINDOW)
  assert.equal(model.maxTokens, FALLBACK_MAX_TOKENS)
})

test("toProviderModels keeps non-Claude models on openai-completions", () => {
  for (const model of toProviderModels(SAMPLE, { rubPerUsd: 0 })) {
    assert.equal(model.api, PROVIDER_API)
  }
})

test("Claude models use native Messages with an SDK-specific base URL", () => {
  for (const id of ["anthropic/claude-haiku-4.5", "claude-haiku-5.5", "claude-sonnet-5.5", "anthropic/claude-opus-5"]) {
    const entry: CatalogModel = { ...SAMPLE[0], id, thinkingLevels: ["low", "high"] }
    const [model] = toProviderModels([entry], { rubPerUsd: 100 })
    assert.equal(model.api, ANTHROPIC_API, id)
    assert.equal(model.baseUrl, "https://plusvibeapi.ru", id)
    assert.equal(model.reasoning, true)
    assert.equal("compat" in model, false)
    assert.equal("thinkingLevelMap" in model, false)
    assert.deepEqual(model.cost, { input: 1, output: 5, cacheRead: 0.25, cacheWrite: 2 })
    const [mirror] = toProviderModels([entry], { rubPerUsd: 0, baseUrl: "https://gw.plusvibeapi.ru/v1/" })
    assert.equal(mirror.baseUrl, "https://gw.plusvibeapi.ru")
  }
})

test("Claude detection supports maker metadata without matching unrelated names", () => {
  assert.equal(isAnthropicModel({ ...SAMPLE[0], maker: " Anthropic " }), true)
  assert.equal(isAnthropicModel({ ...SAMPLE[0], name: "Claude-inspired model" }), false)
  assert.equal(isAnthropicModel({ ...SAMPLE[0], id: "vendor/not-claude-model" }), false)
})

test("Anthropic URL normalization preserves gateway path prefixes", () => {
  assert.equal(anthropicBaseUrl(" https://example.com/proxy/v1/// "), "https://example.com/proxy")
  assert.equal(anthropicBaseUrl("https://example.com/proxy/"), "https://example.com/proxy")
  assert.equal(anthropicBaseUrl("https://example.com"), "https://example.com")
  assert.equal(anthropicBaseUrl("https://example.com/v1beta/"), "https://example.com/v1beta")
})

test("the bundled snapshot routes Claude natively and leaves other models unchanged", () => {
  const models = toProviderModels(SNAPSHOT_MODELS, { rubPerUsd: 0 })
  assert.ok(SNAPSHOT_MODELS.some(isAnthropicModel))
  for (const [i, model] of models.entries()) {
    assert.equal(model.api, isAnthropicModel(SNAPSHOT_MODELS[i]) ? ANTHROPIC_API : PROVIDER_API, model.id)
    if (!isAnthropicModel(SNAPSHOT_MODELS[i])) assert.equal("baseUrl" in model, false, model.id)
  }
})

test("toProviderModels marks model names with the provider suffix", () => {
  const models = toProviderModels([...SAMPLE, ...SNAPSHOT_MODELS], { rubPerUsd: 0 })
  for (const model of models) {
    assert.ok(model.name.endsWith(MODEL_NAME_SUFFIX), `${model.id}: ${model.name}`)
  }
  assert.equal(models[0].name, "With Cost (PV)")
})

test("toProviderModels attaches thinkingLevelMap only when levels are explicit", () => {
  const [withLevels, without] = toProviderModels(SAMPLE, { rubPerUsd: 0 })
  assert.deepEqual(withLevels.thinkingLevelMap, {
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  })
  assert.equal("thinkingLevelMap" in without, false)
})

test("toProviderModels covers the whole bundled snapshot with finite numbers", () => {
  const models = toProviderModels(SNAPSHOT_MODELS, { rubPerUsd: 85 })
  assert.equal(models.length, SNAPSHOT_MODELS.length)

  for (const model of models) {
    assert.ok(Number.isFinite(model.cost.input), `${model.id}: cost.input`)
    assert.ok(Number.isFinite(model.cost.output), `${model.id}: cost.output`)
    assert.ok(Number.isFinite(model.cost.cacheRead), `${model.id}: cost.cacheRead`)
    assert.ok(Number.isFinite(model.cost.cacheWrite), `${model.id}: cost.cacheWrite`)
    assert.ok(Number.isInteger(model.contextWindow) && model.contextWindow > 0, `${model.id}: contextWindow`)
    assert.ok(Number.isInteger(model.maxTokens) && model.maxTokens > 0, `${model.id}: maxTokens`)
    assert.ok(model.input.length > 0, `${model.id}: input`)
  }
})

test("toProviderModels gives DeepSeek models a working thinking setup", () => {
  const models = toProviderModels(
    [
      {
        id: "deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        maker: "DeepSeek",
        reasoning: true,
        input: ["text"],
        contextWindow: 1_048_576,
        maxTokens: 393_216,
      },
      {
        id: "vendor/plain",
        name: "Plain",
        maker: "Other",
        reasoning: true,
        input: ["text"],
        contextWindow: 1000,
        maxTokens: 100,
      },
    ],
    { rubPerUsd: 0 },
  )

  assert.deepEqual(models[0].thinkingLevelMap, {
    off: "none",
    minimal: "medium",
    low: "medium",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  })
  assert.deepEqual(models[0].compat, { thinkingFormat: "openrouter" })
  // Every non-off level must resolve to a value the router treats as "thinking on".
  for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    assert.notEqual(models[0].thinkingLevelMap?.[level], null, level)
    assert.ok(["medium", "high"].includes(models[0].thinkingLevelMap?.[level] as string), level)
  }
  assert.equal("thinkingLevelMap" in models[1], false)
  assert.equal("compat" in models[1], false)
})

test("toProviderModels detects DeepSeek by model id when maker is missing", () => {
  const [model] = toProviderModels(
    [
      {
        id: "deepseek/deepseek-v4-pro-0813",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        input: ["text"],
        contextWindow: 1000,
        maxTokens: 100,
      },
    ],
    { rubPerUsd: 0 },
  )
  assert.deepEqual(model.compat, { thinkingFormat: "openrouter" })
  assert.equal(model.thinkingLevelMap?.low, "medium")
})

test("toProviderModels composes explicit DeepSeek levels with the thinking workaround", () => {
  const [model] = toProviderModels(
    [
      {
        id: "deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        maker: "DeepSeek",
        reasoning: true,
        input: ["text"],
        contextWindow: 1000,
        maxTokens: 100,
        thinkingLevels: ["low", "high"],
      },
    ],
    { rubPerUsd: 0 },
  )
  // The catalog restricts WHICH levels exist; the workaround decides what is
  // sent for them. `low` must not travel as "low": the router reads that as
  // "thinking off".
  assert.deepEqual(model.thinkingLevelMap, {
    off: "none",
    minimal: null,
    low: "medium",
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  })
  assert.deepEqual(model.compat, { thinkingFormat: "openrouter" })
})

test("the bundled snapshot marks every DeepSeek model with the thinking workaround", () => {
  const deepseek = SNAPSHOT_MODELS.filter((model) => /deepseek/i.test(model.id))
  assert.ok(deepseek.length > 0, "snapshot has no DeepSeek models")
  const byId = new Map(toProviderModels(SNAPSHOT_MODELS, { rubPerUsd: 0 }).map((model) => [model.id, model]))
  for (const model of deepseek) {
    assert.deepEqual(byId.get(model.id)?.compat, { thinkingFormat: "openrouter" }, model.id)
    assert.equal(byId.get(model.id)?.thinkingLevelMap?.low, "medium", model.id)
  }
})

test("modelOptionsFromEnv reads PLUSVIBE_RUB_PER_USD", () => {
  assert.deepEqual(modelOptionsFromEnv({}), { rubPerUsd: 0 })
  assert.deepEqual(modelOptionsFromEnv({ PLUSVIBE_RUB_PER_USD: "90" }), { rubPerUsd: 90 })
})

test("serializeSnapshot emits a self-contained typed module", () => {
  const generatedAt = new Date("2026-01-02T03:04:05.000Z")
  const source = serializeSnapshot(SAMPLE, generatedAt)

  assert.ok(source.includes('import type { CatalogModel } from "./catalog.ts"'))
  assert.ok(source.includes('export const SNAPSHOT_GENERATED_AT = "2026-01-02T03:04:05.000Z"'))
  assert.ok(source.includes("export const SNAPSHOT_MODELS: CatalogModel[] = ["))
  assert.ok(source.includes('"vendor/with-cost"'))
  assert.ok(source.includes("Do not edit by hand"))
  // Round-trips through JSON, so the emitted module is valid input for eval.
  const json = source.slice(source.indexOf("= [") + 2, source.lastIndexOf("]") + 1)
  assert.deepEqual(JSON.parse(json), SAMPLE)
})

await run()
