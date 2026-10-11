import assert from "node:assert/strict"

import {
  API_KEY_ENV,
  apiKeyTemplate,
  isUnresolvedTemplate,
  looksLikeApiKey,
  maskApiKey,
  normalizeApiKey,
  resolveApiKey,
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
