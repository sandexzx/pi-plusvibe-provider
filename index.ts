/**
 * Pi provider extension for PlusVibeAPI (plusvibeapi.ru).
 *
 * The extension delegates wire protocols to pi's built-in implementations:
 * `anthropic-messages` for Claude and `openai-completions` for other models.
 * It supplies endpoints, credentials, and the model catalog.
 *
 * Model data comes from the vendor's own Pi integration file
 * (`/api/integrations/pi.models.json`) and is enriched with ruble prices from
 * `/api/catalog`. A snapshot of that merge is bundled in src/catalog-snapshot.ts
 * so the provider works offline; `refreshModels` re-fetches it at runtime.
 *
 * Prices are quoted in rubles and converted to dollars with the daily CBR rate
 * (see src/rate.ts), because pi reports costs in USD.
 */

import type { ExtensionAPI, ExtensionCommandContext, ProviderConfig } from "@earendil-works/pi-coding-agent"

import { baseUrlFromEnv, fetchBalance, fetchCatalog, fetchPiModels } from "./src/api.ts"
import { apiKeyTemplate, resolveApiKeyFromSources } from "./src/api-key.ts"
import { formatBalance } from "./src/balance.ts"
import { PROVIDER_ID, mergeCatalog } from "./src/catalog.ts"
import { SNAPSHOT_MODELS } from "./src/catalog-snapshot.ts"
import { toProviderModels, type ProviderModelDefinition } from "./src/models.ts"
import { getApiKey, login, refreshToken } from "./src/oauth.ts"
import {
  describeRate,
  isRateCacheUsable,
  rateCachePath,
  rateModeFromEnv,
  readRateCache,
  refreshRate,
  syncRubPerUsd,
  type RateQuote,
} from "./src/rate.ts"

export default function plusvibeProvider(pi: ExtensionAPI): void {
  const env = process.env
  const baseUrl = baseUrlFromEnv(env)
  const cachePath = rateCachePath(env)
  const rateMode = rateModeFromEnv(env)

  // Cost reporting needs a RUB→USD rate. Registration is synchronous, so start
  // from the manual setting or the last cached quote and let refreshModels()
  // pick up a newer one without blocking startup. Only the automatic mode shows
  // a cached quote: a manual value must not be described with a cached rate,
  // and a disabled rate must not be described at all.
  let rubPerUsd = syncRubPerUsd(env, { cachePath })
  let rateQuote: RateQuote | undefined = rateMode.kind === "auto" ? readRateCache(cachePath) : undefined
  if (rateQuote && !isRateCacheUsable(rateQuote)) rateQuote = undefined

  // Last good live catalog, kept across refreshes so a transient failure (or an
  // offline run) cannot throw away models that were already fetched.
  let liveModels: ProviderModelDefinition[] | undefined
  let lastVendorModels: unknown
  let lastCatalog: unknown

  /** Build the model list from the bundled snapshot at the current rate. */
  const snapshotModels = () => toProviderModels(SNAPSHOT_MODELS, { rubPerUsd, baseUrl })

  const config: ProviderConfig = {
    baseUrl,
    api: "openai-completions",

    // A literal key (environment or key file) wins; otherwise the
    // `$PLUSVIBE_API_KEY` template: pi expands it from the environment and, when
    // it resolves to nothing, falls back to its own credential store — which is
    // what makes `pi --api-key sk-pv-…` and `/login` work.
    apiKey: resolveApiKeyFromSources(env) ?? apiKeyTemplate(),

    models: snapshotModels(),

    /**
     * Rebuild the catalog from the live endpoints.
     *
     * The three sources are settled independently: a failing price catalog or
     * rate must not discard a fresh model list. The last good merge is kept in
     * memory and reused when a refresh fails, so models never regress to the
     * bundled snapshot after a successful online start.
     */
    async refreshModels(context) {
      if (!context.allowNetwork) return liveModels ?? snapshotModels()

      const [piResult, catalogResult, rateResult] = await Promise.allSettled([
        fetchPiModels({ signal: context.signal }),
        fetchCatalog({ signal: context.signal }),
        refreshRate({ env, cachePath, signal: context.signal }),
      ])

      if (rateResult.status === "fulfilled" && rateResult.value) {
        rateQuote = rateResult.value
        rubPerUsd = rateResult.value.rubPerUsd
      }

      if (piResult.status === "fulfilled") lastVendorModels = piResult.value
      if (catalogResult.status === "fulfilled") lastCatalog = catalogResult.value

      if (lastVendorModels !== undefined && lastCatalog !== undefined) {
        try {
          const merged = mergeCatalog(lastVendorModels, lastCatalog)
          if (merged.length > 0) {
            liveModels = toProviderModels(merged, { rubPerUsd, baseUrl })
            return liveModels
          }
        } catch {
          // Malformed payload: keep the previous live list below.
        }
      }

      return liveModels ?? snapshotModels()
    },

    // PlusVibeAPI has no OAuth server: `/login` asks for an API key and
    // verifies it, then stores it as an OAuth-shaped credential.
    oauth: {
      name: "PlusVibeAPI",
      login,
      refreshToken,
      getApiKey,
    },
  }

  pi.registerProvider(PROVIDER_ID, config)

  pi.registerCommand("plusvibe-balance", {
    description: "Показать баланс PlusVibeAPI",
    handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
      // Prefer the key pi would actually use for requests (a runtime --api-key or
      // stored /login credential) so the balance always matches the account the
      // chats are billed to; the environment is only a fallback.
      let key: string | undefined
      try {
        key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID)
      } catch {
        key = undefined
      }
      if (!key) key = resolveApiKeyFromSources(env)

      if (!key) {
        ctx.ui.notify(
          "Ключ PlusVibeAPI не найден. Задайте PLUSVIBE_API_KEY или выполните /login.",
          "warning",
        )
        return
      }

      const result = await fetchBalance({ apiKey: key, baseUrl: baseUrlFromEnv(env) })

      if (!result.ok) {
        ctx.ui.notify(`Не удалось получить баланс PlusVibeAPI.\n${result.error ?? `HTTP ${result.status}`}`, "error")
        return
      }

      const lines = ["PlusVibeAPI", ...formatBalance(result.data)]
      const rateLine = describeRate(rateQuote, rubPerUsd)
      if (rateLine) lines.push(rateLine)

      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
