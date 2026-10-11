import assert from "node:assert/strict"

import {
  MAX_ATTEMPTS,
  apiKeyFromCredentials,
  credentialsFromApiKey,
  errorMessageFromBody,
  getApiKey,
  login,
  refreshToken,
  validateApiKey,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
} from "../src/oauth.ts"
import { run, test } from "./helpers.ts"

interface FakeCallbacks extends OAuthLoginCallbacks {
  readonly progress: string[]
  readonly prompts: number
}

/**
 * Callbacks backed by a mutable state object. The `progress`/`prompts` getters
 * read through to that state so assertions see the values the flow produced.
 */
function fakeCallbacks(answers: string[]): FakeCallbacks {
  const state = { progress: [] as string[], prompts: 0 }
  return {
    get progress() {
      return state.progress
    },
    get prompts() {
      return state.prompts
    },
    onAuth: () => {},
    onDeviceCode: () => {},
    onProgress: (message: string) => state.progress.push(message),
    onSelect: async () => undefined,
    onPrompt: async () => {
      const answer = answers[state.prompts] ?? ""
      state.prompts += 1
      return answer
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("credentialsFromApiKey wraps the key as a never-expiring credential", () => {
  const credentials = credentialsFromApiKey("sk-pv-abc")
  assert.equal(credentials.access, "sk-pv-abc")
  assert.equal(credentials.refresh, "sk-pv-abc")
  assert.equal(credentials.expires, Number.MAX_SAFE_INTEGER)
})

test("apiKeyFromCredentials prefers access and falls back to refresh", () => {
  assert.equal(apiKeyFromCredentials(credentialsFromApiKey("sk-pv-abc")), "sk-pv-abc")
  assert.equal(apiKeyFromCredentials({ access: "", refresh: "sk-pv-ref", expires: 1 }), "sk-pv-ref")
  assert.equal(apiKeyFromCredentials({ access: "", refresh: "", expires: 1 }), "")
  assert.equal(getApiKey({ access: "sk-pv-abc", refresh: "x", expires: 1 }), "sk-pv-abc")
})

test("refreshToken re-wraps the stored key without a network call", async () => {
  const refreshed = await refreshToken({ access: "sk-pv-abc", refresh: "sk-pv-abc", expires: 0 })
  assert.equal(refreshed.expires, Number.MAX_SAFE_INTEGER)
  await assert.rejects(() => refreshToken({ access: "", refresh: "", expires: 0 }), /пуст/)
})

test("validateApiKey accepts a 200 response", async () => {
  const fetchImpl = (async () => jsonResponse(200, { data: [] })) as unknown as typeof fetch
  const result = await validateApiKey("sk-pv-abc", { fetchImpl, baseUrl: "https://example.test/v1" })
  assert.deepEqual(result, { ok: true, status: 200 })
})

test("validateApiKey surfaces the vendor 401 message", async () => {
  const fetchImpl = (async () =>
    jsonResponse(401, {
      error: { message: "Отсутствует или неверный API-ключ.", type: "authentication_error", code: 401 },
    })) as unknown as typeof fetch

  const result = await validateApiKey("sk-pv-bad", { fetchImpl, baseUrl: "https://example.test/v1" })
  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.match(result.message ?? "", /HTTP 401/)
  assert.match(result.message ?? "", /Отсутствует или неверный API-ключ/)
})

test("validateApiKey reports transport failures without throwing", async () => {
  const fetchImpl = (async () => {
    throw new Error("getaddrinfo ENOTFOUND")
  }) as unknown as typeof fetch

  const result = await validateApiKey("sk-pv-abc", { fetchImpl, baseUrl: "https://example.test/v1" })
  assert.equal(result.ok, false)
  assert.equal(result.status, 0)
  assert.match(result.message ?? "", /ENOTFOUND/)
})

test("errorMessageFromBody handles the documented and unknown shapes", () => {
  assert.equal(errorMessageFromBody('{"error":{"message":"bad key"}}', 401), "Ключ отклонён (HTTP 401): bad key")
  assert.equal(errorMessageFromBody('{"message":"bad request"}', 400), "Проверка ключа не удалась: HTTP 400: bad request")
  assert.equal(errorMessageFromBody("not json", 500), "Проверка ключа не удалась: HTTP 500")
  assert.equal(errorMessageFromBody("{}", 403), "Проверка ключа не удалась: HTTP 403")
})

const VALID_FETCH = (async () => jsonResponse(200, { data: [] })) as unknown as typeof fetch

test("login returns credentials for a valid key", async () => {
  const callbacks = fakeCallbacks(["sk-pv-good"])
  const credentials = await login(callbacks, { fetchImpl: VALID_FETCH })
  assert.equal(credentials.access, "sk-pv-good")
  assert.ok(callbacks.prompts >= 1)
})

test("login normalizes a pasted shell assignment", async () => {
  const callbacks = fakeCallbacks(["export PLUSVIBE_API_KEY='sk-pv-good'"])
  const credentials = await login(callbacks, { fetchImpl: VALID_FETCH })
  assert.equal(credentials.access, "sk-pv-good")
})

test("login gives up after MAX_ATTEMPTS rejected keys", async () => {
  const reject = (async () => jsonResponse(401, { error: { message: "bad key" } })) as unknown as typeof fetch
  const callbacks = fakeCallbacks(["sk-pv-bad1", "sk-pv-bad2", "sk-pv-bad3", "sk-pv-bad4"])

  await assert.rejects(() => login(callbacks, { fetchImpl: reject }), /не удалось подтвердить/)
  assert.equal(callbacks.prompts, MAX_ATTEMPTS)
  assert.ok(callbacks.progress.some((line) => line.includes("HTTP 401")))
})

test("login rejects an empty key without aborting the whole flow", async () => {
  // First answer is empty, second is valid: the prompt is retried, not fatal.
  const callbacks = fakeCallbacks(["", "sk-pv-good"])
  const credentials = await login(callbacks, { fetchImpl: VALID_FETCH })
  assert.equal(credentials.access, "sk-pv-good")
  assert.ok(callbacks.progress.some((line) => line.includes("Пустое")))
})

test("stored credentials round-trip through getApiKey", async () => {
  const credentials: OAuthCredentials = credentialsFromApiKey("sk-pv-roundtrip")
  assert.equal(getApiKey(await refreshToken(credentials)), "sk-pv-roundtrip")
})

await run()
