/**
 * API key resolution for the PlusVibeAPI provider.
 *
 * PlusVibeAPI keys look like `sk-pv-…`. The key can arrive from:
 *   1. the `PLUSVIBE_API_KEY` environment variable,
 *   2. `pi --api-key sk-pv-…` (stored in pi's runtime credential store),
 *   3. `pi`'s `/login`, which stores the pasted key in auth.json.
 *
 * This module only resolves case 1. The value registered with
 * `pi.registerProvider` is the `$PLUSVIBE_API_KEY` template: pi expands it
 * from the environment when present and otherwise falls through to its own
 * credential store, which is what makes /login and --api-key work.
 */

export const API_KEY_ENV = "PLUSVIBE_API_KEY"
export const KEY_PREFIX = "sk-pv-"

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

/** Mask a key for display: `sk-pv-…cdef`. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** True when the value looks like a PlusVibeAPI key. */
export function looksLikeApiKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}
