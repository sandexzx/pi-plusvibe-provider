/**
 * HTTP access to PlusVibeAPI.
 *
 * Kept separate from catalog.ts so the pure merge logic stays testable without
 * a network. All helpers accept an injected `fetch` for tests.
 */

import { sanitizeRemoteText } from "./api-key.ts"
import { CATALOG_URL, DEFAULT_BASE_URL, PI_MODELS_URL, type CatalogModel } from "./catalog.ts"
import { gatewayFilePath, resolveGateway } from "./gateway.ts"

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
  origin?: string
}

/** Normalize `/v1`-style base urls so callers can concatenate paths. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return DEFAULT_BASE_URL
  return trimmed.replace(/\/+$/, "")
}

/**
 * Resolve the current API base URL: environment override, saved gateway, main.
 */
export function baseUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  return resolveGateway(env, gatewayFilePath()).baseUrl
}

/**
 * Combine a caller signal with a timeout into one signal.
 *
 * Exported so the /login validation path (src/oauth.ts) can bound its own
 * request without duplicating the AbortSignal.any() logic.
 */
export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  if (!timeoutMs || timeoutMs <= 0) return signal
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/**
 * Fetch and parse JSON.
 *
 * Throws on transport errors, non-2xx responses, and invalid JSON. Callers
 * that can degrade gracefully (the catalog refresh) catch it themselves.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json", ...options.headers },
    signal: combineSignals(options.signal, options.timeoutMs) ?? null,
  })

  const body = await response.text()
  if (!response.ok) {
    const detail = sanitizeRemoteText(body)
    throw new Error(`${url} -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error(`${url} -> response is not valid JSON`)
  }
}

/**
 * Fetch a plain-text document (used for the CBR XML feed).
 *
 * Same failure semantics as fetchJson, minus the JSON parse.
 */
export async function fetchText(url: string, options: FetchJsonOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/xml, text/xml, text/plain, */*", ...options.headers },
    signal: combineSignals(options.signal, options.timeoutMs) ?? null,
  })

  const body = await response.text()
  if (!response.ok) {
    const detail = sanitizeRemoteText(body)
    throw new Error(`${url} -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
  }

  return body
}

/** The vendor's official pi model list. */
export function fetchPiModels(options: FetchJsonOptions = {}): Promise<unknown> {
  return fetchJson(new URL(new URL(PI_MODELS_URL).pathname, options.origin ?? PI_MODELS_URL).href, { timeoutMs: 30_000, ...options })
}

/** Prices and capability metadata. */
export function fetchCatalog(options: FetchJsonOptions = {}): Promise<unknown> {
  return fetchJson(new URL(new URL(CATALOG_URL).pathname, options.origin ?? CATALOG_URL).href, { timeoutMs: 60_000, ...options })
}

export interface BalanceRequest {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

export interface BalanceResult {
  ok: boolean
  status: number
  data?: unknown
  error?: string
}

/**
 * Read the account balance (`GET /v1/balance`).
 *
 * The endpoint itself is documented (https://plusvibeapi.ru/docs/balance-usage),
 * but its response shape is not, so the raw payload is returned and formatted
 * generically by formatBalance(). Never throws: a failed balance lookup must
 * not break the surrounding command.
 */
export async function fetchBalance(request: BalanceRequest): Promise<BalanceResult> {
  const baseUrl = normalizeBaseUrl(request.baseUrl ?? DEFAULT_BASE_URL)
  const url = `${baseUrl}/balance`
  try {
    const data = await fetchJson(url, {
      fetchImpl: request.fetchImpl,
      signal: request.signal,
      timeoutMs: request.timeoutMs ?? 30_000,
      headers: { authorization: `Bearer ${request.apiKey}` },
    })
    return { ok: true, status: 200, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /-> HTTP (\d+)/.exec(message)?.[1]
    return { ok: false, status: status ? Number(status) : 0, error: message }
  }
}

export type { CatalogModel }
