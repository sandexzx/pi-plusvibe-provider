import assert from "node:assert/strict"
import { InMemoryCredentialStore, InMemoryModelsStore, normalizeContext, type Model } from "@earendil-works/pi-ai"
import { ModelRegistry, ModelRuntime, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent"
// Public package export (`./api/*`), not an unexported internal file.
import { streamSimple } from "@earendil-works/pi-ai/api/anthropic-messages"

import plusvibeProvider from "../index.ts"
import { toProviderModels } from "../src/models.ts"
import { run, test } from "./helpers.ts"

const [definition] = toProviderModels([
  { id: "claude-sonnet-5.5", name: "Sonnet", reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 32_000 },
], { rubPerUsd: 0, baseUrl: "https://gateway.example/proxy/v1/" })
// OpenAI compatibility fields are intentionally absent on Claude definitions.
const { compat: _openAICompat, ...nativeDefinition } = definition
const model: Model<"anthropic-messages"> = { ...nativeDefinition, api: "anthropic-messages", provider: "plusvibe", baseUrl: definition.baseUrl! }

function response(thinking: string): Response {
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: model.id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "test-signature" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Ответ" } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}

for (const thinking of ["Проверю условия задачи.", ""]) {
  test(`native Messages uses the right URL/auth and streams ${thinking ? "visible" : "empty"} thinking`, async () => {
    let payload: Record<string, unknown> = {}
    let calls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      calls++
      const request = new Request(input, init)
      const url = new URL(request.url)
      assert.equal(url.origin + url.pathname, "https://gateway.example/proxy/v1/messages")
      assert.equal(request.headers.get("x-api-key"), "test-key")
      payload = JSON.parse(await request.text()) as Record<string, unknown>
      return response(thinking)
    }
    const stream = streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "Реши задачу", timestamp: 0 }] }), {
      apiKey: "test-key", reasoning: "low", thinkingBudgets: { low: 1024 }, maxTokens: 2048, fetch: fetchImpl,
    })
    const deltas: string[] = []
    for await (const event of stream) {
      if (event.type === "thinking_delta") deltas.push(event.delta)
    }
    const result = await stream.result()
    assert.equal(result.stopReason, "stop", result.errorMessage)
    assert.equal(calls, 1)
    assert.equal(payload.model, model.id, JSON.stringify(payload))
    assert.equal(payload.stream, true)
    assert.equal("reasoning_effort" in payload, false)
    assert.equal("reasoning" in payload, false)
    const nativeThinking = payload.thinking as { type: string; budget_tokens: number }
    assert.equal(nativeThinking.type, "enabled")
    assert.equal(nativeThinking.budget_tokens, 1024)
    assert.ok(Number(payload.max_tokens) > nativeThinking.budget_tokens)
    assert.equal(deltas.join(""), thinking)
    assert.equal(result.stopReason, "stop")
    assert.ok(result.content.some((block) => block.type === "text" && block.text === "Ответ"))
    assert.equal(result.usage.input, 12)
    assert.equal(result.usage.output, 20)
  })
}

test("thinking off explicitly disables native thinking", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const payload = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>
    assert.deepEqual(payload.thinking, { type: "disabled" })
    assert.equal("reasoning_effort" in payload, false)
    return response("")
  }
  const result = await streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "Привет", timestamp: 0 }] }), {
    apiKey: "test-key", fetch: fetchImpl,
  }).result()
  assert.equal(result.stopReason, "stop")
})

test("actual extension registration preserves per-model routing through Pi's registry", async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
  })
  const registry = new ModelRegistry(runtime)
  let config: ProviderConfig | undefined
  const previous = process.env.PLUSVIBE_BASE_URL
  process.env.PLUSVIBE_BASE_URL = "https://gateway.example/proxy/v1/"
  try {
    // Only the extension loading boundary is stubbed; composition, model lookup,
    // authentication and stream dispatch run through the real Pi runtime.
    const pi: Pick<ExtensionAPI, "registerProvider" | "registerCommand"> = {
      registerProvider: (id, providerConfig?: ProviderConfig) => {
        assert.equal(typeof id, "string")
        assert.equal(id, "plusvibe")
        assert.ok(providerConfig)
        config = providerConfig
        registry.registerProvider("plusvibe", providerConfig)
      },
      registerCommand: () => {},
    }
    plusvibeProvider(pi as ExtensionAPI)
    assert.ok(config)
    assert.equal(config.api, "openai-completions")
    assert.equal(config.baseUrl, "https://gateway.example/proxy/v1")
    const claude = registry.getAll().find((entry) => entry.provider === "plusvibe" && entry.id.includes("haiku"))
    const other = registry.getAll().find((entry) => entry.provider === "plusvibe" && entry.id.startsWith("openai/"))
    assert.ok(claude)
    assert.ok(other)
    assert.equal(claude.api, "anthropic-messages")
    assert.equal(claude.baseUrl, "https://gateway.example/proxy")
    assert.equal(other.api, "openai-completions")
    assert.equal(other.baseUrl, config.baseUrl)
    let calls = 0
    let requestUrl = ""
    let requestKey: string | null = null
    let payload: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (input, init) => {
      calls++
      const request = new Request(input, init)
      const url = new URL(request.url)
      requestUrl = url.origin + url.pathname
      requestKey = request.headers.get("x-api-key")
      payload = JSON.parse(await request.text()) as Record<string, unknown>
      return response("Нативный маршрут работает.")
    }
    // Runtime override represents --api-key; no network or stored real secrets.
    await runtime.setRuntimeApiKey("plusvibe", "test-key")
    const stream = registry.streamSimple(claude, { messages: [{ role: "user", content: "Привет", timestamp: 0 }] }, {
      reasoning: "low", thinkingBudgets: { low: 1024 }, maxTokens: 2048, fetch: fetchImpl,
    })
    let thinking = ""
    for await (const event of stream) if (event.type === "thinking_delta") thinking += event.delta
    const result = await stream.result()
    assert.equal(result.stopReason, "stop", result.errorMessage)
    assert.equal(calls, 1)
    assert.equal(requestUrl, "https://gateway.example/proxy/v1/messages")
    assert.equal(requestKey, "test-key")
    assert.equal(payload.model, claude.id)
    const nativeThinking = payload.thinking as { type: string; budget_tokens: number }
    assert.equal(nativeThinking.type, "enabled")
    assert.equal(nativeThinking.budget_tokens, 1024)
    assert.equal("reasoning_effort" in payload, false)
    assert.equal(thinking, "Нативный маршрут работает.")
  } finally {
    registry.unregisterProvider("plusvibe")
    if (previous === undefined) delete process.env.PLUSVIBE_BASE_URL
    else process.env.PLUSVIBE_BASE_URL = previous
  }
})

await run()
