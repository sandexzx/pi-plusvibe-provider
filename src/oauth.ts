/**
 * `/login` support for PlusVibeAPI.
 *
 * PlusVibeAPI has no OAuth server: the only credential is a long-lived API key.
 * The flow therefore asks the user to paste a key, verifies it against
 * `GET /v1/models`, and stores it as an OAuth-shaped credential so pi's
 * existing credential handling (auth.json, refresh, status) keeps working.
 *
 * The local types mirror `OAuthLoginCallbacks` / `OAuthCredentials` from
 * `@earendil-works/pi-ai`. They are declared here instead of imported so this
 * module stays free of a runtime dependency on pi; structural typing makes the
 * object assignable to `ProviderConfig["oauth"]`.
 */

import { looksLikeApiKey, normalizeApiKey, sanitizeRemoteText } from "./api-key.ts"
import { baseUrlFromEnv, combineSignals, normalizeBaseUrl } from "./api.ts"

/** Where users create and copy keys. */
export const DASHBOARD_URL = "https://plusvibeapi.ru/"

export interface OAuthPrompt {
  message: string
  placeholder?: string
  allowEmpty?: boolean
}

export interface OAuthAuthInfo {
  url: string
  instructions?: string
}

export interface OAuthDeviceCodeInfo {
  userCode: string
  verificationUri: string
  intervalSeconds?: number
  expiresInSeconds?: number
}

export interface OAuthSelectOption {
  id: string
  label: string
}

export interface OAuthSelectPrompt {
  message: string
  options: OAuthSelectOption[]
}

export interface OAuthLoginCallbacks {
  onAuth(info: OAuthAuthInfo): void
  onDeviceCode(info: OAuthDeviceCodeInfo): void
  onPrompt(prompt: OAuthPrompt): Promise<string>
  onProgress?(message: string): void
  onManualCodeInput?(): Promise<string>
  onSelect(prompt: OAuthSelectPrompt): Promise<string | undefined>
  signal?: AbortSignal
}

export interface OAuthCredentials {
  refresh: string
  access: string
  expires: number
  [key: string]: unknown
}

/** How many rejected attempts before giving up. */
export const MAX_ATTEMPTS = 3

/**
 * Upper bound for the key-check request.
 *
 * The callbacks' signal may be missing (a programmatic caller), so without a
 * timeout a hung /v1/models request would leave `/login` waiting forever.
 */
export const VALIDATE_TIMEOUT_MS = 15_000

/**
 * Wrap an API key as OAuth-shaped credentials.
 *
 * `expires: Number.MAX_SAFE_INTEGER` marks the credential as never expiring;
 * pi treats a far-future `expires` as a non-refreshable static key.
 */
export function credentialsFromApiKey(key: string): OAuthCredentials {
  return { refresh: key, access: key, expires: Number.MAX_SAFE_INTEGER }
}

/** Extract the API key back out of stored credentials. */
export function apiKeyFromCredentials(credentials: OAuthCredentials): string {
  const candidate =
    typeof credentials.access === "string" && credentials.access.length > 0
      ? credentials.access
      : typeof credentials.refresh === "string"
        ? credentials.refresh
        : ""
  return normalizeApiKey(candidate) ?? ""
}

export interface ValidateOptions {
  baseUrl?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface ValidateResult {
  ok: boolean
  status: number
  message?: string
}

/**
 * Verify a key with `GET /v1/models`.
 *
 * Returns a result instead of throwing so the login loop can re-prompt. The
 * vendor's 401 body is `{"error":{"message":"…","type":"authentication_error",…}}`,
 * whose `message` is surfaced verbatim — redacted, however, because a gateway
 * may echo the Authorization header back.
 */
export async function validateApiKey(key: string, options: ValidateOptions = {}): Promise<ValidateResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? baseUrlFromEnv())
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
      signal: combineSignals(options.signal, options.timeoutMs ?? VALIDATE_TIMEOUT_MS) ?? null,
    })

    if (response.ok) return { ok: true, status: response.status }

    const body = await response.text()
    return { ok: false, status: response.status, message: errorMessageFromBody(body, response.status) }
  } catch (error) {
    const detail = sanitizeRemoteText(error instanceof Error ? error.message : String(error))
    return { ok: false, status: 0, message: `Не удалось связаться с PlusVibeAPI: ${detail}` }
  }
}

/**
 * Turn an error response body into a human-readable message.
 *
 * Handles the vendor shapes `{"error":{"message":"…"}}` and a bare
 * `{"message":"…"}`, falling back to the HTTP status. The upstream string is
 * treated as untrusted: credentials are masked and the length is capped.
 */
export function errorMessageFromBody(body: string, status: number): string {
  let upstream: string | undefined
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown; detail?: unknown }
    const candidate = parsed.error?.message ?? parsed.message ?? parsed.detail
    if (typeof candidate === "string" && candidate.trim().length > 0) upstream = sanitizeRemoteText(candidate)
  } catch {
    // Body is not JSON; keep the status-only message.
  }

  const suffix = upstream ? `: ${upstream}` : ""
  return status === 401
    ? `Ключ отклонён (HTTP 401)${suffix}`
    : `Проверка ключа не удалась: HTTP ${status}${suffix}`
}

/**
 * Prompt → verify → store. Re-prompts up to MAX_ATTEMPTS times.
 */
export async function login(callbacks: OAuthLoginCallbacks, options: ValidateOptions = {}): Promise<OAuthCredentials> {
  callbacks.onProgress?.(`API-ключ можно скопировать на ${DASHBOARD_URL}`)

  const validateOptions: ValidateOptions = { ...options, signal: options.signal ?? callbacks.signal }
  let lastError = "неизвестная ошибка"

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Cancellation must stop the loop: pi may abort while a prompt is open.
    if (validateOptions.signal?.aborted) throw new Error("PlusVibeAPI: вход отменён")

    const raw = await callbacks.onPrompt({
      message: "Вставьте API-ключ PlusVibeAPI (sk-pv-…)",
      placeholder: "sk-pv-…",
      allowEmpty: false,
    })

    if (validateOptions.signal?.aborted) throw new Error("PlusVibeAPI: вход отменён")

    const key = normalizeApiKey(raw)
    if (!key) {
      lastError = "пустое значение"
      callbacks.onProgress?.("Пустое значение, попробуйте ещё раз.")
      continue
    }

    if (!looksLikeApiKey(key)) {
      callbacks.onProgress?.("Ключ не начинается с «sk-pv-». Продолжаю проверку.")
    }

    callbacks.onProgress?.("Проверяю ключ…")
    const result = await validateApiKey(key, validateOptions)

    if (result.ok) return credentialsFromApiKey(key)

    lastError = result.message ?? `HTTP ${result.status}`
    callbacks.onProgress?.(`${lastError}. Попытка ${attempt} из ${MAX_ATTEMPTS}.`)
  }

  throw new Error(`PlusVibeAPI: не удалось подтвердить API-ключ (${lastError})`)
}

/**
 * There is nothing to refresh: the stored value is the API key itself.
 */
export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const key = apiKeyFromCredentials(credentials)
  if (!key) throw new Error("PlusVibeAPI: сохранённый ключ пуст, выполните /login заново")
  return credentialsFromApiKey(key)
}

/** Convert stored credentials into the Bearer key pi should send. */
export function getApiKey(credentials: OAuthCredentials): string {
  return apiKeyFromCredentials(credentials)
}
