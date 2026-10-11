/**
 * Tests for the RUB→USD rate resolution (src/rate.ts).
 *
 * Everything runs offline: sources are reached through an injected `fetch` and
 * the cache lives in a per-test temporary directory.
 */

import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CBR_JSON_URL,
  CBR_XML_URL,
  ER_API_URL,
  RATE_CACHE_TTL_MS,
  RATE_MAX_CACHE_AGE_MS,
  describeRate,
  fetchRemoteRate,
  isRateCacheFresh,
  isRateCacheUsable,
  parseCbrJson,
  parseCbrXml,
  parseErApi,
  rateCachePath,
  rateModeFromEnv,
  readRateCache,
  refreshRate,
  syncRubPerUsd,
  writeRateCache,
  type RateQuote,
} from "../src/rate.ts"
import { run, test } from "./helpers.ts"

const CBR_JSON_FIXTURE = {
  Date: "2026-10-10T11:30:00+03:00",
  Valute: {
    AUD: { Nominal: 1, Value: 59.2551 },
    USD: { Nominal: 1, Value: 80.1234 },
  },
}

const CBR_XML_FIXTURE =
  '<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="10.10.2026" name="Foreign Currency Market">' +
  '<Valute ID="R01010"><NumCode>036</NumCode><CharCode>AUD</CharCode><Nominal>1</Nominal><Value>59,2551</Value></Valute>' +
  '<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Value>80,1234</Value></Valute>' +
  "</ValCurs>"

const ER_API_FIXTURE = { result: "success", rates: { EUR: 0.9, RUB: 80.5 } }

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pv-rate-"))
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
}

/** A fetch stub that answers by URL; anything unknown is a transport error. */
function stubFetch(handlers: Record<string, () => Promise<Response>>) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const handler = handlers[url]
    if (!handler) throw new Error(`unexpected request to ${url}`)
    return await handler()
  }) as unknown as typeof fetch
  return { impl, calls }
}

test("parseCbrJson reads the USD rate and the publication date", () => {
  const sample = parseCbrJson(CBR_JSON_FIXTURE)
  assert.equal(sample?.rubPerUsd, 80.1234)
  assert.equal(sample?.source, "ЦБ РФ (cbr-xml-daily.ru)")
  assert.equal(sample?.date, "2026-10-10T11:30:00+03:00")
})

test("parseCbrJson divides by Nominal", () => {
  const sample = parseCbrJson({ Valute: { USD: { Nominal: 10, Value: 800 } } })
  assert.equal(sample?.rubPerUsd, 80)
})

test("parseCbrJson rejects payloads without a usable USD entry", () => {
  assert.equal(parseCbrJson(null), undefined)
  assert.equal(parseCbrJson("nope"), undefined)
  assert.equal(parseCbrJson({}), undefined)
  assert.equal(parseCbrJson({ Valute: {} }), undefined)
  assert.equal(parseCbrJson({ Valute: { USD: { Nominal: 1, Value: 0 } } }), undefined)
  assert.equal(parseCbrJson({ Valute: { USD: { Nominal: 1, Value: "abc" } } }), undefined)
})

test("parseCbrXml finds the USD block and accepts a comma decimal separator", () => {
  const sample = parseCbrXml(CBR_XML_FIXTURE)
  assert.ok(sample)
  assert.ok(Math.abs(sample.rubPerUsd - 80.1234) < 1e-9)
  assert.equal(sample.source, "ЦБ РФ (cbr.ru)")
  assert.equal(sample.date, "10.10.2026")
})

test("parseCbrXml returns undefined when USD is absent or the document is empty", () => {
  assert.equal(parseCbrXml(""), undefined)
  assert.equal(parseCbrXml("<ValCurs></ValCurs>"), undefined)
  assert.equal(parseCbrXml(CBR_XML_FIXTURE.replace(/USD/g, "GBP")), undefined)
})

test("parseErApi reads rates.RUB", () => {
  assert.equal(parseErApi(ER_API_FIXTURE)?.rubPerUsd, 80.5)
  assert.equal(parseErApi(ER_API_FIXTURE)?.source, "open.er-api.com")
  assert.equal(parseErApi({ rates: {} }), undefined)
  assert.equal(parseErApi(undefined), undefined)
})

test("rateModeFromEnv treats an absent or broken value as auto and 0/off as disabled", () => {
  assert.deepEqual(rateModeFromEnv({}), { kind: "auto" })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "  " }), { kind: "auto" })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "abc" }), { kind: "auto" })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "0" }), { kind: "disabled" })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "OFF" }), { kind: "disabled" })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "85.5" }), { kind: "manual", rubPerUsd: 85.5 })
  assert.deepEqual(rateModeFromEnv({ PLUSVIBE_RUB_PER_USD: "80,5" }), { kind: "manual", rubPerUsd: 80.5 })
})

test("rateCachePath honors PLUSVIBE_CACHE_DIR and XDG_CACHE_HOME", () => {
  assert.equal(rateCachePath({ PLUSVIBE_CACHE_DIR: "/tmp/pv-cache" }), "/tmp/pv-cache/usd-rate.json")
  assert.equal(rateCachePath({ XDG_CACHE_HOME: "/tmp/xdg" }), "/tmp/xdg/pi-plusvibe-provider/usd-rate.json")
  assert.ok(rateCachePath({}).endsWith("pi-plusvibe-provider/usd-rate.json"))
})

test("the rate cache round-trips and survives damaged files", () => {
  const dir = tempDir()
  try {
    const path = join(dir, "usd-rate.json")
    assert.equal(readRateCache(path), undefined)

    const quote: RateQuote = { rubPerUsd: 80.1234, source: "test", date: "2026-10-10", fetchedAt: 1_000 }
    writeRateCache(path, quote)
    assert.deepEqual(readRateCache(path), quote)

    writeFileSync(path, "{ not json", "utf8")
    assert.equal(readRateCache(path), undefined)

    writeFileSync(path, JSON.stringify({ rubPerUsd: -5 }), "utf8")
    assert.equal(readRateCache(path), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("isRateCacheFresh compares against the TTL", () => {
  const quote: RateQuote = { rubPerUsd: 80, source: "test", fetchedAt: 1_000_000 }
  assert.equal(isRateCacheFresh(quote, 1_000_000), true)
  assert.equal(isRateCacheFresh(quote, 1_000_000 + RATE_CACHE_TTL_MS - 1), true)
  assert.equal(isRateCacheFresh(quote, 1_000_000 + RATE_CACHE_TTL_MS), false)
  assert.equal(isRateCacheFresh(quote, 1_000_000, 0), false)
})

test("isRateCacheUsable rejects a quote that is older than the maximum age", () => {
  const quote: RateQuote = { rubPerUsd: 80, source: "test", fetchedAt: 1_000_000 }
  assert.equal(isRateCacheUsable(quote, 1_000_000), true)
  assert.equal(isRateCacheUsable(quote, 1_000_000 + RATE_MAX_CACHE_AGE_MS), true)
  assert.equal(isRateCacheUsable(quote, 1_000_000 + RATE_MAX_CACHE_AGE_MS + 1), false)
  assert.equal(isRateCacheUsable(quote, 1_000_001, 0), false)
})

test("syncRubPerUsd prefers the manual value, then a usable cache, then 0", () => {
  const dir = tempDir()
  try {
    const path = join(dir, "usd-rate.json")
    assert.equal(syncRubPerUsd({}, { cachePath: path }), 0)

    writeRateCache(path, { rubPerUsd: 77.7, source: "test", fetchedAt: Date.now() - 60_000 })
    assert.equal(syncRubPerUsd({}, { cachePath: path }), 77.7)
    assert.equal(syncRubPerUsd({ PLUSVIBE_RUB_PER_USD: "90" }, { cachePath: path }), 90)
    assert.equal(syncRubPerUsd({ PLUSVIBE_RUB_PER_USD: "0" }, { cachePath: path }), 0)

    // Too old to trust: reporting no cost beats reporting a wrong cost.
    writeRateCache(path, { rubPerUsd: 77.7, source: "test", fetchedAt: Date.now() - RATE_MAX_CACHE_AGE_MS - 1_000 })
    assert.equal(syncRubPerUsd({}, { cachePath: path }), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("refreshRate returns undefined when the rate is disabled and a manual quote otherwise", async () => {
  const { impl, calls } = stubFetch({})
  assert.equal(await refreshRate({ env: { PLUSVIBE_RUB_PER_USD: "0" }, fetchImpl: impl }), undefined)

  const manual = await refreshRate({ env: { PLUSVIBE_RUB_PER_USD: "87.25" }, fetchImpl: impl })
  assert.equal(manual?.rubPerUsd, 87.25)
  assert.equal(manual?.source, "PLUSVIBE_RUB_PER_USD")
  assert.deepEqual(calls, [])
})

test("refreshRate ignores a cache entry that is too old to trust", async () => {
  const dir = tempDir()
  try {
    const cachePath = join(dir, "usd-rate.json")
    const now = 5_000_000_000_000
    writeRateCache(cachePath, { rubPerUsd: 79, source: "старое", fetchedAt: 0 })

    const { impl, calls } = stubFetch({ [CBR_JSON_URL]: async () => jsonResponse(CBR_JSON_FIXTURE) })
    const quote = await refreshRate({ env: {}, cachePath, now, fetchImpl: impl })
    assert.equal(quote?.rubPerUsd, 80.1234)
    assert.deepEqual(calls, [CBR_JSON_URL])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("refreshRate serves a fresh cache without touching the network", async () => {
  const dir = tempDir()
  try {
    const cachePath = join(dir, "usd-rate.json")
    const now = 5_000_000
    writeRateCache(cachePath, { rubPerUsd: 79, source: "ЦБ РФ (cbr.ru)", fetchedAt: now - 1_000 })

    const { impl, calls } = stubFetch({})
    const quote = await refreshRate({ env: {}, cachePath, now, fetchImpl: impl })
    assert.equal(quote?.rubPerUsd, 79)
    assert.deepEqual(calls, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("refreshRate fetches and caches once the cached quote is stale", async () => {
  const dir = tempDir()
  try {
    const cachePath = join(dir, "usd-rate.json")
    const now = 9_000_000
    writeRateCache(cachePath, { rubPerUsd: 79, source: "старое", fetchedAt: now - RATE_CACHE_TTL_MS - 1 })

    const { impl, calls } = stubFetch({ [CBR_JSON_URL]: async () => jsonResponse(CBR_JSON_FIXTURE) })
    const quote = await refreshRate({ env: {}, cachePath, now, fetchImpl: impl })
    assert.equal(quote?.rubPerUsd, 80.1234)
    assert.deepEqual(calls, [CBR_JSON_URL])
    assert.equal(readRateCache(cachePath)?.rubPerUsd, 80.1234)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("fetchRemoteRate falls back to the next source when one fails or is unusable", async () => {
  const brokenXmlThenJson = stubFetch({
    [CBR_JSON_URL]: async () => new Response("upstream exploded", { status: 502 }),
    [CBR_XML_URL]: async () => new Response("<ValCurs></ValCurs>", { status: 200 }),
    [ER_API_URL]: async () => jsonResponse(ER_API_FIXTURE),
  })
  const quote = await fetchRemoteRate({ fetchImpl: brokenXmlThenJson.impl })
  assert.equal(quote?.source, "open.er-api.com")
  assert.equal(quote?.rubPerUsd, 80.5)
  assert.deepEqual(brokenXmlThenJson.calls, [CBR_JSON_URL, CBR_XML_URL, ER_API_URL])

  const xmlOnly = stubFetch({
    [CBR_JSON_URL]: async () => {
      throw new Error("offline")
    },
    [CBR_XML_URL]: async () => new Response(CBR_XML_FIXTURE, { status: 200 }),
  })
  const fromXml = await fetchRemoteRate({ fetchImpl: xmlOnly.impl })
  assert.equal(fromXml?.source, "ЦБ РФ (cbr.ru)")
})

test("fetchRemoteRate returns undefined when every source is down", async () => {
  const offline = stubFetch({})
  assert.equal(await fetchRemoteRate({ fetchImpl: offline.impl }), undefined)
  assert.equal(offline.calls.length, 3)
})

test("fetchRemoteRate stops asking once the total budget is exhausted", async () => {
  const offline = stubFetch({})
  assert.equal(await fetchRemoteRate({ fetchImpl: offline.impl, totalBudgetMs: 0 }), undefined)
  assert.deepEqual(offline.calls, [])
})

test("describeRate renders the rate, the source, and the date", () => {
  const quote: RateQuote = { rubPerUsd: 80.1234, source: "ЦБ РФ (cbr.ru)", date: "10.10.2026", fetchedAt: 0 }
  assert.equal(describeRate(quote, 0), "Курс: 80.12 ₽/$ · ЦБ РФ (cbr.ru) · 10.10.2026")
  assert.equal(describeRate(undefined, 90), "Курс: 90.00 ₽/$")
  assert.equal(describeRate(undefined, 0), undefined)
})

await run()
