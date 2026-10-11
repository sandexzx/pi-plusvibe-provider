/**
 * Pure catalog logic for the PlusVibeAPI provider.
 *
 * No I/O and no imports from pi packages live here so the module can be unit
 * tested in isolation and reused by scripts/sync-catalog.ts.
 *
 * Data sources (both public, no API key required):
 *   - https://plusvibeapi.ru/api/integrations/pi.models.json
 *       The vendor's official pi model list. Authoritative for `id`, `name`,
 *       `reasoning`, `input`, `contextWindow`, `maxTokens`.
 *   - https://plusvibeapi.ru/api/catalog
 *       Prices (ruble per million tokens) and capability metadata. Used only
 *       to enrich, never to override the vendor pi list.
 */

/** Unified catalog endpoints. */
export const PI_MODELS_URL = "https://plusvibeapi.ru/api/integrations/pi.models.json"
export const CATALOG_URL = "https://plusvibeapi.ru/api/catalog"

/** Wire defaults. Both can be overridden with environment variables. */
export const PROVIDER_ID = "plusvibe"
export const DEFAULT_BASE_URL = "https://plusvibeapi.ru/v1"
export const FALLBACK_BASE_URL = "https://gw.plusvibeapi.ru/v1"

export const ENV_API_KEY = "PLUSVIBE_API_KEY"
export const ENV_BASE_URL = "PLUSVIBE_BASE_URL"
export const ENV_RUB_PER_USD = "PLUSVIBE_RUB_PER_USD"

/** pi thinking levels, in ascending effort order. `off` is always accepted. */
export const PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number]

/** Mirrors pi's ThinkingLevelMap: a string maps the level, `null` disables it. */
export type ThinkingLevelMap = Partial<Record<PiThinkingLevel | "off", string | null>>

/** Ruble rates per million tokens, as published by the catalog. */
export interface CostRub {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Usd rates per million tokens, in the shape pi expects. */
export interface Cost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One chat model, normalized for pi. */
export interface CatalogModel {
  id: string
  name: string
  /** Vendor that trains the model, e.g. "DeepSeek". Used for wire quirks. */
  maker?: string
  reasoning: boolean
  input: ("text" | "image")[]
  contextWindow: number
  maxTokens: number
  costRub?: CostRub
  thinkingLevels?: PiThinkingLevel[]
}

export const ZERO_COST: Cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isPiThinkingLevel(value: unknown): value is PiThinkingLevel {
  return typeof value === "string" && (PI_THINKING_LEVELS as readonly string[]).includes(value)
}

/**
 * Extract the explicit reasoning-effort levels advertised for a model.
 *
 * The catalog uses the same vocabulary as pi for effort-style models
 * (`low`/`medium`/...), but uses prose for models that only switch thinking on
 * or off (`thinking`, `extended thinking`). Prose levels return undefined so
 * pi keeps its provider defaults instead of being handed a bogus map.
 */
export function explicitThinkingLevels(levels: unknown): PiThinkingLevel[] | undefined {
  if (!Array.isArray(levels)) return undefined
  const known = levels.filter(isPiThinkingLevel)
  return known.length > 0 ? known : undefined
}

/**
 * Build a pi thinking level map from the advertised effort levels.
 *
 * Every pi level is written explicitly: supported levels map to themselves,
 * unsupported ones to `null`, so pi hides them from `/thinking` and clamps
 * requests instead of sending an effort the model rejects.
 */
export function thinkingLevelMapFor(levels: PiThinkingLevel[] | undefined): ThinkingLevelMap | undefined {
  if (!levels || levels.length === 0) return undefined
  const supported = new Set<string>(levels)
  const map: ThinkingLevelMap = {}
  for (const level of PI_THINKING_LEVELS) {
    map[level] = supported.has(level) ? level : null
  }
  return map
}

/**
 * True for DeepSeek-family models, which need a router-specific thinking setup.
 *
 * The model id is checked as a fallback so a missing `maker` field cannot drop
 * the workaround silently.
 */
export function isDeepSeekModel(model: CatalogModel): boolean {
  if (model.maker?.trim().toLowerCase() === "deepseek") return true
  return /deepseek/i.test(model.id)
}

function defaultVariant(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const variants = Array.isArray(entry.variants) ? entry.variants : []
  const records = variants.filter(isRecord)
  return records.find((variant) => variant.isDefault === true) ?? records[0]
}

function costRubFromVariant(variant: Record<string, unknown> | undefined): CostRub | undefined {
  if (!variant) return undefined
  const input = finiteNumber(variant.inputRub)
  const output = finiteNumber(variant.outputRub)
  if (input === undefined && output === undefined) return undefined
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: finiteNumber(variant.cachedInputRub) ?? 0,
    cacheWrite: finiteNumber(variant.cachedWriteInputRub) ?? 0,
  }
}

/**
 * Merge the vendor pi model list with the catalog into one normalized list.
 *
 * Throws when either payload has an unexpected shape, so a broken upstream
 * response fails loudly instead of silently producing an empty model list.
 */
export function mergeCatalog(piModelsJson: unknown, catalogJson: unknown): CatalogModel[] {
  if (!isRecord(piModelsJson)) throw new Error("pi.models.json: expected an object")
  const providers = piModelsJson.providers
  if (!isRecord(providers)) throw new Error("pi.models.json: missing providers")
  const provider = providers[PROVIDER_ID]
  if (!isRecord(provider)) throw new Error(`pi.models.json: missing providers.${PROVIDER_ID}`)
  const rawModels = provider.models
  if (!Array.isArray(rawModels)) throw new Error("pi.models.json: models is not an array")
  if (!Array.isArray(catalogJson)) throw new Error("/api/catalog: expected an array")

  const catalogById = new Map<string, Record<string, unknown>>()
  for (const entry of catalogJson) {
    if (!isRecord(entry)) continue
    if (typeof entry.apiModel === "string") catalogById.set(entry.apiModel, entry)
    if (typeof entry.model === "string" && !catalogById.has(entry.model)) {
      catalogById.set(entry.model, entry)
    }
  }

  const models: CatalogModel[] = []
  const seen = new Set<string>()
  for (const raw of rawModels) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) continue
    if (seen.has(raw.id)) continue
    seen.add(raw.id)

    const input = (Array.isArray(raw.input) ? raw.input : []).filter(
      (value): value is "text" | "image" => value === "text" || value === "image",
    )

    const entry = catalogById.get(raw.id)
    const variant = entry ? defaultVariant(entry) : undefined

    const model: CatalogModel = {
      id: raw.id,
      name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.id,
      reasoning: raw.reasoning === true,
      input: input.length > 0 ? input : ["text"],
      contextWindow: finiteNumber(raw.contextWindow) ?? 0,
      maxTokens: finiteNumber(raw.maxTokens) ?? 0,
    }

    if (typeof entry?.maker === "string" && entry.maker.length > 0) model.maker = entry.maker

    const costRub = costRubFromVariant(variant)
    if (costRub) model.costRub = costRub
    const caps = isRecord(entry?.caps) ? entry.caps : undefined
    const reasoning = isRecord(caps?.reasoning) ? caps.reasoning : undefined
    const levels = explicitThinkingLevels(reasoning?.levels)
    if (levels) model.thinkingLevels = levels

    models.push(model)
  }

  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}

/**
 * Parse the RUB→USD rate from `PLUSVIBE_RUB_PER_USD`.
 *
 * Returns 0 ("cost reporting disabled") for unset, non-numeric, or
 * non-positive values. The router bills in rubles; without an explicit rate
 * pi would display ruble numbers as dollars, so reporting stays off until the
 * user opts in.
 */
export function parseRubPerUsd(raw: string | undefined): number {
  if (raw === undefined) return 0
  const parsed = Number(raw.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Convert ruble rates into pi's USD cost fields. Zero rate disables cost. */
export function toCost(costRub: CostRub | undefined, rubPerUsd: number): Cost {
  if (!costRub || rubPerUsd <= 0) return ZERO_COST
  return {
    input: costRub.input / rubPerUsd,
    output: costRub.output / rubPerUsd,
    cacheRead: costRub.cacheRead / rubPerUsd,
    cacheWrite: costRub.cacheWrite / rubPerUsd,
  }
}
