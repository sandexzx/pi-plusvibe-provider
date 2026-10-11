/**
 * Automatic RUB→USD rate for cost reporting.
 *
 * PlusVibeAPI prices its models in rubles, but pi displays costs in dollars.
 * The rate is resolved in this order:
 *
 *   1. `PLUSVIBE_RUB_PER_USD` — an explicit value wins; `0`/`off` disables
 *      cost reporting entirely.
 *   2. A cached quote from an earlier run, however old — a stale rate is still
 *      closer to the truth than `$0.00`.
 *   3. `0`, meaning "unknown"; costs stay hidden until the first fetch works.
 *
 * Quotes come from free, key-less sources, tried in order: the CBR daily JSON
 * mirror, the CBR XML endpoint, and open.er-api.com. The cache lives in
 * `$PLUSVIBE_CACHE_DIR` → `$XDG_CACHE_HOME/pi-plusvibe-provider` →
 * `~/.cache/pi-plusvibe-provider`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { fetchJson, fetchText } from "./api.ts"

export const ENV_RUB_PER_USD = "PLUSVIBE_RUB_PER_USD"
export const ENV_CACHE_DIR = "PLUSVIBE_CACHE_DIR"

export const CBR_JSON_URL = "https://www.cbr-xml-daily.ru/daily_json.js"
export const CBR_XML_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
export const ER_API_URL = "https://open.er-api.com/v6/latest/USD"

export const CBR_JSON_SOURCE = "ЦБ РФ (cbr-xml-daily.ru)"
export const CBR_XML_SOURCE = "ЦБ РФ (cbr.ru)"
export const ER_API_SOURCE = "open.er-api.com"
export const MANUAL_SOURCE = "PLUSVIBE_RUB_PER_USD"

/** The CBR publishes one rate per business day; half a day of cache is plenty. */
export const RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const RATE_CACHE_FILE = "usd-rate.json"

/** Per-source timeout. */
export const RATE_TIMEOUT_MS = 8_000

/** Upper bound for the whole source chain, so a dead network cannot stall a model refresh. */
export const RATE_TOTAL_BUDGET_MS = 15_000

/** A rate sample as returned by a source, before it is stamped and cached. */
export interface RateSample {
  rubPerUsd: number
  source: string
  /** Publication date of the quote, when the source reports one. */
  date?: string
}

/** A usable quote: a sample plus the moment it was retrieved. */
export interface RateQuote extends RateSample {
  fetchedAt: number
}

export type RateMode =
  | { kind: "auto" }
  | { kind: "disabled" }
  | { kind: "manual"; rubPerUsd: number }

const DISABLED_VALUES = new Set(["0", "off", "none", "false", "no", "disabled"])

/** Interpret `PLUSVIBE_RUB_PER_USD`: absent = auto, `0`/`off` = disabled. */
export function rateModeFromEnv(env: Record<string, string | undefined> = process.env): RateMode {
  const raw = env[ENV_RUB_PER_USD]
  if (typeof raw !== "string" || raw.trim().length === 0) return { kind: "auto" }

  const value = raw.trim()
  if (DISABLED_VALUES.has(value.toLowerCase())) return { kind: "disabled" }

  const parsed = positiveNumber(value.replace(",", "."))
  // An unparsable value (typo, stray text) falls back to the live rate instead
  // of silently disabling cost reporting.
  return parsed === undefined ? { kind: "auto" } : { kind: "manual", rubPerUsd: parsed }
}

function positiveNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** `{Valute:{USD:{Nominal,Value}}}` — the daily_json.js mirror of the CBR feed. */
export function parseCbrJson(payload: unknown): RateSample | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const record = payload as { Date?: unknown; Valute?: unknown }
  if (typeof record.Valute !== "object" || record.Valute === null) return undefined

  const usd = (record.Valute as Record<string, unknown>).USD
  if (typeof usd !== "object" || usd === null) return undefined

  const entry = usd as { Nominal?: unknown; Value?: unknown }
  const value = positiveNumber(entry.Value)
  const nominal = positiveNumber(entry.Nominal) ?? 1
  if (value === undefined) return undefined

  return {
    rubPerUsd: value / nominal,
    source: CBR_JSON_SOURCE,
    date: typeof record.Date === "string" ? record.Date : undefined,
  }
}

/**
 * `<Valute>` block with `<CharCode>USD</CharCode>` from cbr.ru/scripts/XML_daily.asp.
 *
 * The document is windows-1251, but every field used here (CharCode, Nominal,
 * Value, Date) is ASCII, so a UTF-8 decode is enough and no ICU codec is needed.
 * Values use a comma as the decimal separator.
 */
export function parseCbrXml(text: string): RateSample | undefined {
  if (typeof text !== "string") return undefined

  for (const block of text.match(/<Valute\b[\s\S]*?<\/Valute>/gi) ?? []) {
    if (!/<CharCode>\s*USD\s*<\/CharCode>/i.test(block)) continue

    const nominal = positiveNumber(/<Nominal>\s*([\d.,]+)\s*<\/Nominal>/i.exec(block)?.[1]) ?? 1
    const value = positiveNumber(/<Value>\s*([\d.,]+)\s*<\/Value>/i.exec(block)?.[1])
    if (value === undefined) return undefined

    return {
      rubPerUsd: value / nominal,
      source: CBR_XML_SOURCE,
      date: /<ValCurs[^>]*Date="([^"]+)"/i.exec(text)?.[1],
    }
  }

  return undefined
}

/** `{rates:{RUB}}` from open.er-api.com (daily-updated, USD base). */
export function parseErApi(payload: unknown): RateSample | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const rates = (payload as { rates?: unknown }).rates
  if (typeof rates !== "object" || rates === null) return undefined

  const rub = positiveNumber((rates as Record<string, unknown>).RUB)
  if (rub === undefined) return undefined

  return { rubPerUsd: rub, source: ER_API_SOURCE }
}

export interface FetchRateOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  /** Total time allowed for the whole source chain, not for a single request. */
  totalBudgetMs?: number
}

/**
 * Ask every source in order; return the first usable quote, else undefined.
 *
 * The chain shares one deadline, so even with an unreachable network the wait
 * stays bounded and a model refresh is never stalled for long.
 */
export async function fetchRemoteRate(options: FetchRateOptions = {}): Promise<RateQuote | undefined> {
  const deadline = Date.now() + (options.totalBudgetMs ?? RATE_TOTAL_BUDGET_MS)
  const perSource = options.timeoutMs ?? RATE_TIMEOUT_MS

  const attempts: ((timeoutMs: number) => Promise<RateSample | undefined>)[] = [
    async (timeoutMs) => parseCbrJson(await fetchJson(CBR_JSON_URL, { ...options, timeoutMs })),
    async (timeoutMs) => parseCbrXml(await fetchText(CBR_XML_URL, { ...options, timeoutMs })),
    async (timeoutMs) => parseErApi(await fetchJson(ER_API_URL, { ...options, timeoutMs })),
  ]

  for (const attempt of attempts) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    try {
      const sample = await attempt(Math.min(perSource, remaining))
      if (sample) return { ...sample, fetchedAt: Date.now() }
    } catch {
      // Try the next source: a mirror may be down or the network may be blocked.
    }
  }

  return undefined
}

/** `$PLUSVIBE_CACHE_DIR` → `$XDG_CACHE_HOME/pi-plusvibe-provider` → `~/.cache/…`. */
export function cacheDir(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[ENV_CACHE_DIR]
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim()

  const xdg = env.XDG_CACHE_HOME
  if (typeof xdg === "string" && xdg.trim().length > 0) return join(xdg.trim(), "pi-plusvibe-provider")

  return join(homedir(), ".cache", "pi-plusvibe-provider")
}

export function rateCachePath(env: Record<string, string | undefined> = process.env): string {
  return join(cacheDir(env), RATE_CACHE_FILE)
}

/** Read a cached quote. Returns undefined for missing, unreadable, or invalid files. */
export function readRateCache(path: string): RateQuote | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RateQuote>
    const rate = positiveNumber(parsed.rubPerUsd)
    if (rate === undefined) return undefined

    return {
      rubPerUsd: rate,
      source: typeof parsed.source === "string" ? parsed.source : "cache",
      date: typeof parsed.date === "string" ? parsed.date : undefined,
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
    }
  } catch {
    return undefined
  }
}

/** Persist a quote. Best effort: a read-only cache directory is not fatal. */
export function writeRateCache(path: string, quote: RateQuote): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(quote, null, 2)}\n`, "utf8")
  } catch {
    // Ignore: the rate still applies for this session.
  }
}

export function isRateCacheFresh(quote: RateQuote, now: number = Date.now(), ttl: number = RATE_CACHE_TTL_MS): boolean {
  return now - quote.fetchedAt < ttl
}

/**
 * The rate available without any I/O wait, for provider registration:
 * a manual value, else whatever the cache holds, else 0 (unknown).
 */
export function syncRubPerUsd(
  env: Record<string, string | undefined> = process.env,
  options: { cachePath?: string } = {},
): number {
  const mode = rateModeFromEnv(env)
  if (mode.kind === "manual") return mode.rubPerUsd
  if (mode.kind === "disabled") return 0

  const cached = readRateCache(options.cachePath ?? rateCachePath(env))
  return cached?.rubPerUsd ?? 0
}

export interface RefreshRateOptions extends FetchRateOptions {
  env?: Record<string, string | undefined>
  cachePath?: string
  now?: number
  ttl?: number
}

/**
 * Resolve the rate for the current session.
 *
 * Uses the cached quote while it is fresh, otherwise asks the network and
 * refreshes the cache. Returns undefined when the rate is disabled, when a
 * manual value is configured (that one is already in effect), or when every
 * source failed.
 */
export async function refreshRate(options: RefreshRateOptions = {}): Promise<RateQuote | undefined> {
  const env = options.env ?? process.env
  const cachePath = options.cachePath ?? rateCachePath(env)
  const now = options.now ?? Date.now()

  const mode = rateModeFromEnv(env)
  if (mode.kind === "disabled") return undefined
  if (mode.kind === "manual") {
    return { rubPerUsd: mode.rubPerUsd, source: MANUAL_SOURCE, fetchedAt: now }
  }

  const cached = readRateCache(cachePath)
  if (cached && isRateCacheFresh(cached, now, options.ttl ?? RATE_CACHE_TTL_MS)) return cached

  const remote = await fetchRemoteRate(options)
  if (remote) writeRateCache(cachePath, remote)
  return remote
}

/** One-line description used by the `/plusvibe-balance` output. */
export function describeRate(quote: RateQuote | undefined, rubPerUsd: number): string | undefined {
  const rate = quote?.rubPerUsd ?? rubPerUsd
  if (!(rate > 0)) return undefined

  const parts = [`Курс: ${rate.toFixed(2)} ₽/$`]
  if (quote) {
    parts.push(quote.source)
    if (quote.date) parts.push(quote.date.slice(0, 10))
  }
  return parts.join(" · ")
}
