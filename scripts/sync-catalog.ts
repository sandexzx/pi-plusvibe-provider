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
import { fetchJson } from "../src/api.ts"
import { serializeSnapshot } from "../src/models.ts"

async function main(): Promise<void> {
  const [piModels, catalog] = await Promise.all([
    fetchJson(PI_MODELS_URL, { timeoutMs: 30_000 }),
    fetchJson(CATALOG_URL, { timeoutMs: 60_000 }),
  ])

  const models: CatalogModel[] = mergeCatalog(piModels, catalog)
  if (models.length === 0) throw new Error("refusing to write an empty snapshot")

  const output = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "catalog-snapshot.ts")
  await writeFile(output, serializeSnapshot(models, new Date()), "utf8")

  const withCost = models.filter((model) => model.costRub).length
  const withLevels = models.filter((model) => model.thinkingLevels).length
  console.log(
    `wrote ${models.length} models to ${output} (${withCost} priced, ${withLevels} with explicit thinking levels)`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
