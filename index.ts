/**
 * Pi provider extension for PlusVibeAPI (plusvibeapi.ru).
 *
 * PlusVibeAPI is an OpenAI-compatible gateway, so the extension delegates the
 * wire protocol to pi's built-in `openai-completions` implementation and only
 * supplies the endpoint, credentials, and the model catalog.
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
import { apiKeyTemplate, resolveApiKey } from "./src/api-key.ts"
import { formatBalance } from "./src/balance.ts"
import { PROVIDER_ID, mergeCatalog } from "./src/catalog.ts"
import { SNAPSHOT_MODELS } from "./src/catalog-snapshot.ts"
import { toProviderModels } from "./src/models.ts"
import { getApiKey, login, refreshToken } from "./src/oauth.ts"
import { describeRate, rateCachePath, readRateCache, refreshRate, syncRubPerUsd, type RateQuote } from "./src/rate.ts"

export default function plusvibeProvider(pi: ExtensionAPI): void {
  const env = process.env
  const baseUrl = baseUrlFromEnv(env)
  const cachePath = rateCachePath(env)

  // Cost reporting needs a RUB→USD rate. Registration is synchronous, so start
  // from the manual setting or the last cached quote and let refreshModels()
  // pick up a newer one without blocking startup.
  let rubPerUsd = syncRubPerUsd(env, { cachePath })
  let rateQuote: RateQuote | undefined = readRateCache(cachePath)

  /** Build the model list from the bundled snapshot at the current rate. */
  const snapshotModels = () => toProviderModels(SNAPSHOT_MODELS, { rubPerUsd })

  const config: ProviderConfig = {
    baseUrl,
    api: "openai-completions",

    // `$PLUSVIBE_API_KEY` is expanded from the environment when present;
    // otherwise pi falls back to its credential store, which is what makes
    // `pi --api-key sk-pv-…` and `/login` work.
    apiKey: apiKeyTemplate(),

    models: snapshotModels(),

    /**
     * Rebuild the catalog from the live endpoints.
     *
     * Any failure (offline, endpoint moved, malformed payload) silently keeps
     * the bundled snapshot so model selection never breaks.
     */
    async refreshModels(context) {
      if (!context.allowNetwork) return snapshotModels()

      try {
        const [piModels, catalog, quote] = await Promise.all([
          fetchPiModels({ signal: context.signal }),
          fetchCatalog({ signal: context.signal }),
          refreshRate({ env, cachePath, signal: context.signal }),
        ])

        if (quote) {
          rateQuote = quote
          rubPerUsd = quote.rubPerUsd
        }

        const merged = mergeCatalog(piModels, catalog)
        if (merged.length === 0) return snapshotModels()

        return toProviderModels(merged, { rubPerUsd })
      } catch {
        return snapshotModels()
      }
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
      const key = resolveApiKey(env) ?? (await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID))

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
