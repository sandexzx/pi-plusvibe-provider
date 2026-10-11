/**
 * API key resolution for the PlusVibeAPI provider.
 *
 * PlusVibeAPI keys look like `sk-pv-…`. The key can arrive from:
 *   1. the `PLUSVIBE_API_KEY` environment variable,
 *   2. a key file (`PLUSVIBE_API_KEY_FILE`, default `~/.config/plusvibe/key`),
 *   3. `pi --api-key sk-pv-…` (stored in pi's runtime credential store),
 *   4. `pi`'s `/login`, which stores the pasted key in auth.json.
 *
 * This module resolves cases 1 and 2. When neither yields a key, the value
 * registered with `pi.registerProvider` is the `$PLUSVIBE_API_KEY` template:
 * pi expands it from the environment and otherwise falls through to its own
 * credential store, which is what makes /login and --api-key work.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const API_KEY_ENV = "PLUSVIBE_API_KEY"
export const API_KEY_FILE_ENV = "PLUSVIBE_API_KEY_FILE"
export const KEY_PREFIX = "sk-pv-"

/** Default location of the optional key file. */
export const DEFAULT_KEY_FILE = join(homedir(), ".config", "plusvibe", "key")

/** The env template handed to `pi.registerProvider`. */
export function apiKeyTemplate(): string {
  return `$${API_KEY_ENV}`
}

/**
 * Clean a pasted key: strip whitespace, surrounding quotes, and any
 * `export VAR=` / `VAR=` prefix users copy out of a shell snippet.
 */
export function normalizeApiKey(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined

  let value = raw.trim()
  if (value.length === 0) return undefined

  // `export PLUSVIBE_API_KEY=sk-pv-...` / `PLUSVIBE_API_KEY=sk-pv-...`
  const assignment = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.*)$/s.exec(value)
  if (assignment) {
    value = assignment[1].trim()
  }

  // Matching single, double, or backtick quotes.
  const quoted = /^(['"`])(.*)\1$/s.exec(value)
  if (quoted) value = quoted[2].trim()

  if (value.length === 0) return undefined
  return value
}

/**
 * True when the value is still an unexpanded template placeholder such as
 * `$PLUSVIBE_API_KEY` or `${PLUSVIBE_API_KEY}`.
 */
export function isUnresolvedTemplate(value: string): boolean {
  return /^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(value.trim())
}

/** Resolve the key from the environment. */
export function resolveApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const value = normalizeApiKey(env[API_KEY_ENV])
  if (!value || isUnresolvedTemplate(value)) return undefined
  return value
}

/** Path of the optional key file: `PLUSVIBE_API_KEY_FILE` or the default location. */
export function apiKeyFilePath(env: Record<string, string | undefined> = process.env): string {
  const configured = env[API_KEY_FILE_ENV]
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim()
  return DEFAULT_KEY_FILE
}

/** File-system dependencies, injectable for tests. */
export interface KeyFileOptions {
  path?: string
  readFile?: (path: string) => string
}

/**
 * Read the key from a file, so the key never has to sit in the environment.
 *
 * Returns undefined for a missing, unreadable, or empty file. The trailing
 * newline a `printf`/editor leaves behind is stripped by normalizeApiKey().
 */
export function resolveApiKeyFile(
  env: Record<string, string | undefined> = process.env,
  options: KeyFileOptions = {},
): string | undefined {
  const path = options.path ?? apiKeyFilePath(env)
  const read = options.readFile ?? ((target: string) => readFileSync(target, "utf8"))
  try {
    const value = normalizeApiKey(read(path))
    if (!value || isUnresolvedTemplate(value)) return undefined
    return value
  } catch {
    return undefined
  }
}

/** Key from the environment, else from the key file. */
export function resolveApiKeyFromSources(
  env: Record<string, string | undefined> = process.env,
  options: KeyFileOptions = {},
): string | undefined {
  return resolveApiKey(env) ?? resolveApiKeyFile(env, options)
}

/** Mask a key for display: `sk-pv-…cdef`. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** True when the value looks like a PlusVibeAPI key. */
export function looksLikeApiKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}

/** A PlusVibeAPI key, wherever it appears in a string. */
const KEY_PATTERN = /sk-pv-[A-Za-z0-9._-]+/gi

/** `Bearer <token>`, however the token was spelled. */
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/-]{6,}=*/gi

/**
 * Replace anything that looks like a credential with a mask.
 *
 * Remote error bodies are echoed into pi's UI and into /login prompts. A
 * gateway that reflects the Authorization header (for example
 * `Invalid Authorization: Bearer sk-pv-…`) would otherwise print the key.
 */
export function redactSecrets(text: string): string {
  // Bearer first: a masked `sk-pv-***` would otherwise look like a token again.
  return text.replace(BEARER_PATTERN, "$1***").replace(KEY_PATTERN, `${KEY_PREFIX}***`)
}

/** Redact credentials and cap the length of an untrusted remote message. */
export function sanitizeRemoteText(text: string, maxLength = 300): string {
  const redacted = redactSecrets(text).trim()
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted
}
