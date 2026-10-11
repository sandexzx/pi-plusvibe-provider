/**
 * Projection of catalog entries onto pi provider model definitions.
 */

import {
  CATALOG_URL,
  PI_MODELS_URL,
  PI_THINKING_LEVELS,
  isDeepSeekModel,
  thinkingLevelMapFor,
  toCost,
  type CatalogModel,
  type Cost,
  type ThinkingLevelMap,
} from "./catalog.ts"
import { rateModeFromEnv } from "./rate.ts"

/** Fallbacks used only when an upstream entry omits usable limits. */
export const FALLBACK_CONTEXT_WINDOW = 128_000
export const FALLBACK_MAX_TOKENS = 16_384

/** Wire used for every PlusVibeAPI chat model. */
export const PROVIDER_API = "openai-completions"

/** Structural subset of pi's OpenAICompletionsCompat. */
export interface ThinkingFormatCompat {
  thinkingFormat?: "openai" | "openrouter" | "deepseek"
}

/** Structural subset of pi's ProviderChatModelConfig. */
export interface ProviderModelDefinition {
  id: string
  name: string
  api: typeof PROVIDER_API
  reasoning: boolean
  input: ("text" | "image")[]
  cost: Cost
  contextWindow: number
  maxTokens: number
  thinkingLevelMap?: ThinkingLevelMap
  compat?: ThinkingFormatCompat
}

/**
 * Thinking setup for DeepSeek-family models on this router.
 *
 * Measured behaviour of https://plusvibeapi.ru/v1/chat/completions (model
 * `deepseek-v4.1-flash` and `deepseek/deepseek-v4-pro-0813`, characters of
 * `reasoning_content` in the stream):
 *
 *   reasoning_effort absent  -> thinking ON (349)
 *   none / minimal / low     -> thinking OFF (0)
 *   medium / high / xhigh / max -> thinking ON (227 / 586 / 346 / 180)
 *
 * The router ignores the DeepSeek-native `thinking: {type}` field entirely and
 * only reacts to the effort value, so pi's default level `low` silently turns
 * thinking off and the user sees no reasoning block. Remapping `minimal`/`low`
 * onto `medium` keeps every non-off level thinking, and the nested
 * `reasoning: {effort}` object (thinkingFormat `openrouter`) is honored as well,
 * which additionally makes `off` able to send `none` - with the default
 * `openai` format nothing is sent for `off` and thinking would stay on.
 */
export const DEEPSEEK_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  off: "none",
  minimal: "medium",
  low: "medium",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
}

export const DEEPSEEK_COMPAT: ThinkingFormatCompat = { thinkingFormat: "openrouter" }

/**
 * Thinking setup for a single model.
 *
 * Non-DeepSeek models only get a map when the catalog advertises explicit
 * levels. DeepSeek models ALWAYS go through the workaround table: the catalog
 * levels decide which pi levels stay selectable (`null` hides the rest), while
 * the effort value sent on the wire comes from DEEPSEEK_THINKING_LEVEL_MAP, so
 * `low` cannot leak through as "thinking off" when the vendor list happens to
 * publish explicit levels.
 */
export function thinkingLevelMapForModel(model: CatalogModel): ThinkingLevelMap | undefined {
  if (!isDeepSeekModel(model)) return thinkingLevelMapFor(model.thinkingLevels)

  const supported =
    model.thinkingLevels && model.thinkingLevels.length > 0 ? new Set<string>(model.thinkingLevels) : undefined

  const map: ThinkingLevelMap = { off: DEEPSEEK_THINKING_LEVEL_MAP.off ?? "none" }
  for (const level of PI_THINKING_LEVELS) {
    map[level] = supported && !supported.has(level) ? null : (DEEPSEEK_THINKING_LEVEL_MAP[level] ?? level)
  }
  return map
}

export interface ProviderModelOptions {
  /** RUB→USD divisor. 0 disables cost reporting (pi would show $0.00). */
  rubPerUsd: number
}

/** Convert normalized catalog entries into pi provider model definitions. */
export function toProviderModels(
  models: readonly CatalogModel[],
  options: ProviderModelOptions,
): ProviderModelDefinition[] {
  return models.map((model) => {
    const definition: ProviderModelDefinition = {
      id: model.id,
      name: model.name,
      api: PROVIDER_API,
      reasoning: model.reasoning,
      input: [...model.input],
      cost: toCost(model.costRub, options.rubPerUsd),
      contextWindow: model.contextWindow > 0 ? model.contextWindow : FALLBACK_CONTEXT_WINDOW,
      maxTokens: model.maxTokens > 0 ? model.maxTokens : FALLBACK_MAX_TOKENS,
    }

    const thinkingLevelMap = thinkingLevelMapForModel(model)
    if (thinkingLevelMap) definition.thinkingLevelMap = thinkingLevelMap
    if (isDeepSeekModel(model)) definition.compat = DEEPSEEK_COMPAT

    return definition
  })
}

/**
 * Environment-only model options.
 *
 * Only an explicit `PLUSVIBE_RUB_PER_USD` is honored here; the automatic daily
 * rate needs a cache read (or the network) and is resolved in src/rate.ts.
 */
export function modelOptionsFromEnv(env: Record<string, string | undefined> = process.env): ProviderModelOptions {
  const mode = rateModeFromEnv(env)
  return { rubPerUsd: mode.kind === "manual" ? mode.rubPerUsd : 0 }
}

/** Render a catalog snapshot as the TypeScript module the extension bundles. */
export function serializeSnapshot(models: readonly CatalogModel[], generatedAt: Date): string {
  const body = JSON.stringify(models, null, 2)
  return `/**
 * Generated by scripts/sync-catalog.ts. Do not edit by hand.
 *
 * Sources:
 *   ${PI_MODELS_URL}
 *   ${CATALOG_URL}
 *
 * Generated: ${generatedAt.toISOString()}
 */

import type { CatalogModel } from "./catalog.ts"

export const SNAPSHOT_GENERATED_AT = ${JSON.stringify(generatedAt.toISOString())}

export const SNAPSHOT_MODELS: CatalogModel[] = ${body}
`
}

export { PI_THINKING_LEVELS }
