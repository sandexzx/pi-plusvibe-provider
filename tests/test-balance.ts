import assert from "node:assert/strict"

import { formatBalance } from "../src/balance.ts"
import { run, test } from "./helpers.ts"

test("formatBalance labels known scalar keys in Russian", () => {
  assert.deepEqual(formatBalance({ balance: 123.45, currency: "RUB" }), ["Баланс: 123.45", "Валюта: RUB"])
})

test("formatBalance trims trailing zeros from fractional numbers", () => {
  assert.deepEqual(formatBalance({ balance: 100.0 }), ["Баланс: 100"])
  assert.deepEqual(formatBalance({ balance: 10.5 }), ["Баланс: 10.5"])
})

test("formatBalance translates the leaf key of a dotted path", () => {
  assert.deepEqual(formatBalance({ account: { balance: 5, currency: "RUB" } }), ["Баланс: 5", "Валюта: RUB"])
})

test("formatBalance indexes arrays", () => {
  assert.deepEqual(formatBalance({ items: [{ amount: 1 }, { amount: 2 }] }), ["Сумма: 1", "Сумма: 2"])
})

test("formatBalance skips nullish values", () => {
  assert.deepEqual(formatBalance({ bonus: true, plan: null, extra: undefined }), ["Бонус: да"])
})

test("formatBalance keeps unknown keys verbatim", () => {
  assert.deepEqual(formatBalance({ something_weird: 7 }), ["something_weird: 7"])
})

test("formatBalance falls back to JSON when nothing survives the depth limit", () => {
  assert.deepEqual(formatBalance({ deep: { a: { b: { c: { d: 1 } } } } }), [
    '{"deep":{"a":{"b":{"c":{"d":1}}}}}',
  ])
})

test("formatBalance falls back to JSON for values it cannot flatten", () => {
  assert.deepEqual(formatBalance({}), ["{}"])
  assert.deepEqual(formatBalance(42), ["42"])
  assert.deepEqual(formatBalance("ok"), ["ok"])
  assert.deepEqual(formatBalance([]), ["[]"])
})

test("formatBalance never throws on a cyclic payload", () => {
  const cyclic: Record<string, unknown> = { balance: 1 }
  cyclic.self = cyclic
  // The depth-limited walk terminates before it ever touches JSON.stringify,
  // so the cycle simply repeats until the depth budget runs out.
  const lines = formatBalance(cyclic)
  assert.ok(lines.length >= 1)
  assert.ok(lines.every((line) => line === "Баланс: 1"))
})

await run()
