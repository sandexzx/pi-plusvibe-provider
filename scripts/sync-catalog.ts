#!/usr/bin/env node
/**
 * Regenerate src/catalog-snapshot.ts from the public PlusVibeAPI endpoints.
 *
 * The snapshot is the offline/first-run fallback: the extension refreshes the
 * live catalog on startup, but a bundled copy keeps models available when the
 * network is down or the user is offline.
 *
 * Usage: npm run sync:catalog   (tsx scripts/sync-catalog.ts)
 */

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { CATALOG_URL, PI_MODELS_URL, mergeCatalog, type CatalogModel } from "../src/catalog.ts"
import { SNAPSHOT_MODELS } from "../src/catalog-snapshot.ts"
import { fetchJson } from "../src/api.ts"
import { serializeSnapshot } from "../src/models.ts"

/** Refuse to shrink the snapshot below this fraction of the previous one. */
const MIN_SNAPSHOT_RATIO = 0.8

async function main(): Promise<void> {
  const force = process.argv.includes("--force")
  const [piModels, catalog] = await Promise.all([
    fetchJson(PI_MODELS_URL, { timeoutMs: 30_000 }),
    fetchJson(CATALOG_URL, { timeoutMs: 60_000 }),
  ])

  const models: CatalogModel[] = mergeCatalog(piModels, catalog)
  if (models.length === 0) throw new Error("refusing to write an empty snapshot")

  const priced = models.filter((model) => model.costRub).length
  const withLevels = models.filter((model) => model.thinkingLevels).length
  const noLimits = models.filter((model) => model.contextWindow <= 0 || model.maxTokens <= 0).length

  const previousCount = SNAPSHOT_MODELS.length
  const previousPriced = SNAPSHOT_MODELS.filter((model) => model.costRub).length
  const shrank = models.length < previousCount * MIN_SNAPSHOT_RATIO
  const pricesDropped = previousPriced > 0 && priced < previousPriced * MIN_SNAPSHOT_RATIO

  if (!force && (shrank || pricesDropped)) {
    throw new Error(
      `refusing to overwrite the snapshot: models ${previousCount} -> ${models.length}, ` +
        `priced ${previousPriced} -> ${priced}. ` +
        "An upstream field rename looks likely; review the diff, then re-run with --force.",
    )
  }

  const output = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog-snapshot.ts")
  await writeFile(output, serializeSnapshot(models, new Date()), "utf8")

  console.log(`wrote ${models.length} models to ${output}`)
  console.log(`  priced: ${priced}/${models.length}, explicit thinking levels: ${withLevels}`)
  console.log(`  missing limits (contextWindow/maxTokens): ${noLimits}`)
  if (shrank || pricesDropped) console.log("  (written despite the drop because --force was given)")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
