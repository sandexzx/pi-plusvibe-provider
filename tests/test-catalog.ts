import assert from "node:assert/strict"

import {
  PI_THINKING_LEVELS,
  ZERO_COST,
  explicitThinkingLevels,
  mergeCatalog,
  parseRubPerUsd,
  thinkingLevelMapFor,
  toCost,
} from "../src/catalog.ts"
import { SNAPSHOT_MODELS } from "../src/catalog-snapshot.ts"
import { run, test } from "./helpers.ts"

const PI_MODELS_FIXTURE = {
  providers: {
    plusvibe: {
      baseUrl: "https://plusvibeapi.ru/v1",
      api: "openai-completions",
      models: [
        { id: "vendor/model-a", name: "Model A", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 32000 },
        { id: "vendor/model-b", name: "Model B", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 },
      ],
    },
  },
}

const CATALOG_FIXTURE = [
  {
    model: "vendor/model-a",
    apiModel: "vendor/model-a",
    caps: { contextWindow: 200000, reasoning: { levels: ["minimal", "low", "medium", "high", "xhigh", "max"] } },
    variants: [
      { variant: "alt", isDefault: false, inputRub: 1, outputRub: 2 },
      {
        variant: "main",
        isDefault: true,
        inputRub: 100,
        outputRub: 500,
        cachedInputRub: 25,
        cachedWriteInputRub: 200,
      },
    ],
  },
  {
    model: "vendor/model-b",
    apiModel: "vendor/model-b",
    caps: { reasoning: { levels: ["thinking"] } },
    variants: [{ variant: "main", inputRub: 10, outputRub: 20 }],
  },
]

test("mergeCatalog keeps vendor pi.models.json values and enriches from the catalog", () => {
  const merged = mergeCatalog(PI_MODELS_FIXTURE, CATALOG_FIXTURE)
  assert.equal(merged.length, 2)

  const [modelA, modelB] = merged
  assert.equal(modelA.id, "vendor/model-a")
  assert.equal(modelA.name, "Model A")
  assert.equal(modelA.reasoning, true)
  assert.deepEqual(modelA.input, ["text", "image"])
  assert.equal(modelA.contextWindow, 200000)
  assert.equal(modelA.maxTokens, 32000)
  assert.deepEqual(modelA.costRub, { input: 100, output: 500, cacheRead: 25, cacheWrite: 200 })
  assert.deepEqual(modelA.thinkingLevels, ["minimal", "low", "medium", "high", "xhigh", "max"])

  // Prose levels such as "thinking" must not become a thinking level map.
  assert.equal(modelB.thinkingLevels, undefined)
  assert.equal(modelB.reasoning, false)
  assert.deepEqual(modelB.input, ["text"])
})

test("mergeCatalog sorts by id, drops duplicate ids, and tolerates a model missing from the catalog", () => {
  const withExtra = {
    providers: {
      plusvibe: {
        models: [
          { id: "zeta", name: "Z", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100 },
          { id: "alpha", name: "A", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100 },
          { id: "alpha", name: "A dup", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100 },
        ],
      },
    },
  }
  const merged = mergeCatalog(withExtra, [])
  assert.deepEqual(
    merged.map((model) => model.id),
    ["alpha", "zeta"],
  )
  assert.equal(merged[0].costRub, undefined)
  assert.equal(merged[0].contextWindow, 1000)
})

test("mergeCatalog rejects malformed payloads instead of silently returning nothing", () => {
  assert.throws(() => mergeCatalog(null, []), /expected an object/)
  assert.throws(() => mergeCatalog({}, []), /missing providers/)
  assert.throws(() => mergeCatalog({ providers: {} }, []), /missing providers\.plusvibe/)
  assert.throws(() => mergeCatalog({ providers: { plusvibe: {} } }, []), /models is not an array/)
  assert.throws(() => mergeCatalog(PI_MODELS_FIXTURE, {}), /expected an array/)
})

test("explicitThinkingLevels keeps only pi-vocabulary levels", () => {
  assert.deepEqual(explicitThinkingLevels(["low", "high"]), ["low", "high"])
  assert.deepEqual(explicitThinkingLevels(["thinking", "low"]), ["low"])
  assert.equal(explicitThinkingLevels(["thinking"]), undefined)
  assert.equal(explicitThinkingLevels(["extended thinking"]), undefined)
  assert.equal(explicitThinkingLevels([]), undefined)
  assert.equal(explicitThinkingLevels(undefined), undefined)
  assert.equal(explicitThinkingLevels("low"), undefined)
})

test("thinkingLevelMapFor marks unsupported levels as null", () => {
  assert.deepEqual(thinkingLevelMapFor(["low", "high"]), {
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  })
  // "off" is intentionally absent: pi keeps its default when a level is missing.
  assert.equal(thinkingLevelMapFor(undefined), undefined)
  assert.equal(thinkingLevelMapFor([]), undefined)
  assert.equal(Object.keys(thinkingLevelMapFor([...PI_THINKING_LEVELS])!).length, PI_THINKING_LEVELS.length)
})

test("parseRubPerUsd only accepts a positive number", () => {
  assert.equal(parseRubPerUsd(undefined), 0)
  assert.equal(parseRubPerUsd(""), 0)
  assert.equal(parseRubPerUsd("abc"), 0)
  assert.equal(parseRubPerUsd("0"), 0)
  assert.equal(parseRubPerUsd("-80"), 0)
  assert.equal(parseRubPerUsd("85.5"), 85.5)
  assert.equal(parseRubPerUsd(" 90 "), 90)
})

test("toCost converts rubles to dollars only when a rate is configured", () => {
  const rub = { input: 100, output: 500, cacheRead: 25, cacheWrite: 200 }
  assert.deepEqual(toCost(rub, 0), ZERO_COST)
  assert.deepEqual(toCost(undefined, 100), ZERO_COST)
  assert.deepEqual(toCost(rub, 100), { input: 1, output: 5, cacheRead: 0.25, cacheWrite: 2 })
})

test("the bundled snapshot is complete and internally consistent", () => {
  assert.ok(SNAPSHOT_MODELS.length > 50, `expected a large snapshot, got ${SNAPSHOT_MODELS.length}`)

  const ids = new Set<string>()
  for (const model of SNAPSHOT_MODELS) {
    assert.ok(model.id.length > 0, "model id must not be empty")
    assert.ok(!ids.has(model.id), `duplicate model id: ${model.id}`)
    ids.add(model.id)
    assert.ok(model.contextWindow > 0, `${model.id}: contextWindow must be positive`)
    assert.ok(model.maxTokens > 0, `${model.id}: maxTokens must be positive`)
    assert.ok(model.input.length > 0, `${model.id}: input must not be empty`)
    assert.ok(typeof model.reasoning === "boolean", `${model.id}: reasoning must be boolean`)
  }

  const sorted = [...SNAPSHOT_MODELS].sort((left, right) => left.id.localeCompare(right.id))
  assert.deepEqual(
    SNAPSHOT_MODELS.map((model) => model.id),
    sorted.map((model) => model.id),
    "snapshot must stay sorted by id",
  )

  const priced = SNAPSHOT_MODELS.filter((model) => model.costRub).length
  assert.ok(priced > 0, "at least some models must carry ruble prices")
})

await run()
