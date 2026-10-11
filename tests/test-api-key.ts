import assert from "node:assert/strict"

import {
  API_KEY_ENV,
  apiKeyFilePath,
  apiKeyTemplate,
  isUnresolvedTemplate,
  looksLikeApiKey,
  maskApiKey,
  normalizeApiKey,
  redactSecrets,
  resolveApiKey,
  resolveApiKeyFile,
  resolveApiKeyFromSources,
  sanitizeRemoteText,
} from "../src/api-key.ts"
import { run, test } from "./helpers.ts"

test("apiKeyTemplate stays a shell-safe env reference for pi to expand", () => {
  assert.equal(apiKeyTemplate(), `$${API_KEY_ENV}`)
})

test("normalizeApiKey strips whitespace, quotes, and shell assignments", () => {
  assert.equal(normalizeApiKey("sk-pv-abc"), "sk-pv-abc")
  assert.equal(normalizeApiKey("  sk-pv-abc\n"), "sk-pv-abc")
  assert.equal(normalizeApiKey("'sk-pv-abc'"), "sk-pv-abc")
  assert.equal(normalizeApiKey('"sk-pv-abc"'), "sk-pv-abc")
  assert.equal(normalizeApiKey("`sk-pv-abc`"), "sk-pv-abc")
  assert.equal(normalizeApiKey("export PLUSVIBE_API_KEY=sk-pv-abc"), "sk-pv-abc")
  assert.equal(normalizeApiKey("PLUSVIBE_API_KEY=sk-pv-abc"), "sk-pv-abc")
  assert.equal(normalizeApiKey("export PLUSVIBE_API_KEY='sk-pv-abc'"), "sk-pv-abc")
  assert.equal(normalizeApiKey(""), undefined)
  assert.equal(normalizeApiKey("   "), undefined)
  assert.equal(normalizeApiKey(undefined), undefined)
  assert.equal(normalizeApiKey(null), undefined)
})

test("isUnresolvedTemplate detects bare $VAR and ${VAR} placeholders", () => {
  assert.equal(isUnresolvedTemplate("$PLUSVIBE_API_KEY"), true)
  assert.equal(isUnresolvedTemplate("${PLUSVIBE_API_KEY}"), true)
  assert.equal(isUnresolvedTemplate(" $PLUSVIBE_API_KEY "), true)
  assert.equal(isUnresolvedTemplate("sk-pv-abc"), false)
  assert.equal(isUnresolvedTemplate("$PLUSVIBE_API_KEY-extra"), false)
})

test("resolveApiKey reads the environment and ignores placeholders", () => {
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "sk-pv-live" }), "sk-pv-live")
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "'sk-pv-quoted'" }), "sk-pv-quoted")
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "" }), undefined)
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "  " }), undefined)
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "$PLUSVIBE_API_KEY" }), undefined)
  assert.equal(resolveApiKey({}), undefined)
  assert.equal(resolveApiKey({ [API_KEY_ENV]: "sk-pv-  spaces  " }), "sk-pv-  spaces")
})

test("apiKeyFilePath honours PLUSVIBE_API_KEY_FILE", () => {
  assert.equal(apiKeyFilePath({ PLUSVIBE_API_KEY_FILE: "/run/secrets/pv" }), "/run/secrets/pv")
  assert.equal(apiKeyFilePath({ PLUSVIBE_API_KEY_FILE: "  " }), apiKeyFilePath({}))
  assert.ok(apiKeyFilePath({}).endsWith("plusvibe/key"))
})

test("resolveApiKeyFile reads and cleans the key file", () => {
  const file = (content: string | Error) => () => {
    if (content instanceof Error) throw content
    return content
  }

  assert.equal(resolveApiKeyFile({}, { path: "k", readFile: file("sk-pv-file\n") }), "sk-pv-file")
  assert.equal(resolveApiKeyFile({}, { path: "k", readFile: file("export PLUSVIBE_API_KEY='sk-pv-quoted'") }), "sk-pv-quoted")
  assert.equal(resolveApiKeyFile({}, { path: "k", readFile: file("") }), undefined)
  assert.equal(resolveApiKeyFile({}, { path: "k", readFile: file("$PLUSVIBE_API_KEY") }), undefined)
  assert.equal(resolveApiKeyFile({}, { path: "k", readFile: file(new Error("ENOENT")) }), undefined)
})

test("resolveApiKeyFromSources prefers the environment over the key file", () => {
  const options = { path: "k", readFile: () => "sk-pv-file" }
  assert.equal(resolveApiKeyFromSources({ [API_KEY_ENV]: "sk-pv-env" }, options), "sk-pv-env")
  assert.equal(resolveApiKeyFromSources({}, options), "sk-pv-file")
  assert.equal(
    resolveApiKeyFromSources({}, {
      path: "k",
      readFile: () => {
        throw new Error("EACCES")
      },
    }),
    undefined,
  )
})

test("redactSecrets masks keys and bearer tokens in remote text", () => {
  assert.equal(redactSecrets("Invalid Authorization: Bearer sk-pv-secret-test"), "Invalid Authorization: Bearer ***")
  assert.equal(redactSecrets("key sk-pv-abc.def-123 rejected"), "key sk-pv-*** rejected")
  assert.equal(redactSecrets("Bearer abcdefghijklmnopqrstuvwxyz"), "Bearer ***")
  assert.equal(redactSecrets("no credentials here"), "no credentials here")
})

test("sanitizeRemoteText redacts, trims, and caps untrusted text", () => {
  assert.equal(sanitizeRemoteText("  Bearer sk-pv-abcdef  "), "Bearer ***")
  assert.equal(sanitizeRemoteText(""), "")
  const capped = sanitizeRemoteText("x".repeat(500))
  assert.equal(capped.length, 301)
  assert.ok(capped.endsWith("…"))
})

test("maskApiKey never leaks a full key", () => {
  assert.equal(maskApiKey("sk-pv-1234567890abcdef"), "sk-pv-…cdef")
  assert.equal(maskApiKey("short"), "shor…")
  const masked = maskApiKey("sk-pv-abcdefghijklmnop")
  assert.ok(!masked.includes("abcdefghij"))
})

test("looksLikeApiKey recognizes the vendor prefix", () => {
  assert.equal(looksLikeApiKey("sk-pv-abc"), true)
  assert.equal(looksLikeApiKey("sk-abc"), false)
  assert.equal(looksLikeApiKey(""), false)
})

await run()
