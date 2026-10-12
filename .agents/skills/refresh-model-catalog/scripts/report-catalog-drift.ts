#!/usr/bin/env node
/**
 * Read-only catalog drift report for pi-plusvibe-provider.
 *
 * Fetches the two public PlusVibeAPI endpoints, merges them exactly like the
 * extension does, and compares the result with the bundled snapshot in
 * src/catalog-snapshot.ts. Nothing is written, so this is safe to run before
 * `npm run sync:catalog`.
 *
 * Usage (from the repository root):
 *   npx tsx .agents/skills/refresh-model-catalog/scripts/report-catalog-drift.ts [--json]
 *
 * Exit code is 0 when the report is produced (drift or not) and 1 when an
 * endpoint cannot be read or the payloads cannot be merged. Malformed model
 * records are skipped by mergeCatalog(), so exit 0 is not a schema audit.
 */

import { fetchCatalog, fetchPiModels } from "../../../../src/api.ts"
import { isDeepSeekModel, mergeCatalog, type CatalogModel, type CostRub } from "../../../../src/catalog.ts"
import { SNAPSHOT_GENERATED_AT, SNAPSHOT_MODELS } from "../../../../src/catalog-snapshot.ts"

const COST_FIELDS: (keyof CostRub)[] = ["input", "output", "cacheRead", "cacheWrite"]

function formatCostRub(cost: CostRub | undefined): string {
  if (!cost) return "(none)"
  return COST_FIELDS.map((field) => `${field} ${cost[field]}`).join(", ")
}

function formatLevels(levels: readonly string[] | undefined): string {
  return levels && levels.length > 0 ? levels.join("/") : "(none)"
}

/** Levels compared as a set: the projection uses a Set, so order carries no meaning. */
function canonicalLevels(levels: readonly string[] | undefined): string {
  return levels && levels.length > 0 ? [...new Set(levels)].sort().join("/") : "(none)"
}

/** Field-level differences for one model id, as human-readable lines. */
function describeModelChanges(before: CatalogModel, after: CatalogModel): string[] {
  const changes: string[] = []

  if (before.name !== after.name) changes.push(`name: ${before.name} -> ${after.name}`)
  if (before.maker !== after.maker) changes.push(`maker: ${before.maker ?? "(none)"} -> ${after.maker ?? "(none)"}`)
  if (before.reasoning !== after.reasoning) changes.push(`reasoning: ${before.reasoning} -> ${after.reasoning}`)

  const inputBefore = [...before.input].sort().join("+")
  const inputAfter = [...after.input].sort().join("+")
  if (inputBefore !== inputAfter) changes.push(`input: ${inputBefore} -> ${inputAfter}`)

  if (before.contextWindow !== after.contextWindow) {
    changes.push(`contextWindow: ${before.contextWindow} -> ${after.contextWindow}`)
  }
  if (before.maxTokens !== after.maxTokens) changes.push(`maxTokens: ${before.maxTokens} -> ${after.maxTokens}`)
  if (canonicalLevels(before.thinkingLevels) !== canonicalLevels(after.thinkingLevels)) {
    changes.push(`thinkingLevels: ${formatLevels(before.thinkingLevels)} -> ${formatLevels(after.thinkingLevels)}`)
  } else if (formatLevels(before.thinkingLevels) !== formatLevels(after.thinkingLevels)) {
    changes.push(
      `thinkingLevels order: ${formatLevels(before.thinkingLevels)} -> ${formatLevels(after.thinkingLevels)}` +
        " (serialization only, no capability change)",
    )
  }

  if (!before.costRub || !after.costRub) {
    if (before.costRub !== after.costRub) {
      changes.push(`costRub: ${formatCostRub(before.costRub)} -> ${formatCostRub(after.costRub)}`)
    }
  } else {
    for (const field of COST_FIELDS) {
      if (before.costRub[field] !== after.costRub[field]) {
        changes.push(`costRub.${field}: ${before.costRub[field]} -> ${after.costRub[field]}`)
      }
    }
  }

  return changes
}

function hasExplicitLevels(model: CatalogModel): boolean {
  return model.thinkingLevels !== undefined && model.thinkingLevels.length > 0
}

function formatIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "none"
}

function formatCounted(label: string, ids: readonly string[]): string {
  return `- ${label} (${ids.length}): ${formatIds(ids)}`
}

function countByMaker(models: readonly CatalogModel[]): Record<string, number> {
  // Null prototype: an upstream maker named "constructor" or "__proto__" must not hit inherited keys.
  const counts: Record<string, number> = Object.create(null)
  for (const model of models) {
    const maker = model.maker ?? "(none)"
    counts[maker] = (counts[maker] ?? 0) + 1
  }
  return counts
}

/** Limits must be positive integers; the snapshot tests reject anything else. */
function hasInvalidLimits(model: CatalogModel): boolean {
  return (
    !Number.isInteger(model.contextWindow) ||
    model.contextWindow <= 0 ||
    !Number.isInteger(model.maxTokens) ||
    model.maxTokens <= 0
  )
}

/** Capability summary used to spot metadata that silently degrades. */
function capabilities(models: readonly CatalogModel[]) {
  return {
    total: models.length,
    priced: models.filter((model) => model.costRub).length,
    unpricedIds: models.filter((model) => !model.costRub).map((model) => model.id),
    zeroPriceIds: models
      .filter((model) => model.costRub && (model.costRub.input === 0 || model.costRub.output === 0))
      .map((model) => model.id),
    imageIds: models.filter((model) => model.input.includes("image")).length,
    reasoningIds: models.filter((model) => model.reasoning).length,
    explicitLevelCount: models.filter(hasExplicitLevels).length,
    explicitLevelIds: models.filter(hasExplicitLevels).map((model) => model.id),
    invalidLimitsIds: models.filter(hasInvalidLimits).map((model) => model.id),
    deepseekIds: models.filter(isDeepSeekModel).map((model) => model.id),
    makers: countByMaker(models),
  }
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json")

  const [piModels, catalog] = await Promise.all([
    fetchPiModels({ timeoutMs: 30_000 }),
    fetchCatalog({ timeoutMs: 60_000 }),
  ])

  const live = mergeCatalog(piModels, catalog)
  const snapshotById = new Map(SNAPSHOT_MODELS.map((model) => [model.id, model]))
  const liveById = new Map(live.map((model) => [model.id, model]))

  const added = live.filter((model) => !snapshotById.has(model.id)).map((model) => model.id)
  const removed = SNAPSHOT_MODELS.filter((model) => !liveById.has(model.id)).map((model) => model.id)
  const changed = live
    .filter((model) => snapshotById.has(model.id))
    .map((model) => ({ id: model.id, changes: describeModelChanges(snapshotById.get(model.id)!, model) }))
    .filter((entry) => entry.changes.length > 0)

  const snapshotMakers = new Set(Object.keys(countByMaker(SNAPSHOT_MODELS)))
  const liveCapabilities = capabilities(live)
  const newMakers = Object.keys(liveCapabilities.makers).filter((maker) => !snapshotMakers.has(maker))

  const generatedAt = Date.parse(SNAPSHOT_GENERATED_AT)
  const ageDays = Number.isFinite(generatedAt) ? Math.floor((Date.now() - generatedAt) / 86_400_000) : undefined

  const report = {
    snapshot: {
      generatedAt: SNAPSHOT_GENERATED_AT,
      ageDays,
      models: SNAPSHOT_MODELS.length,
      capabilities: capabilities(SNAPSHOT_MODELS),
    },
    live: liveCapabilities,
    drift: { added, removed, changed, newMakers },
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log("# PlusVibeAPI catalog drift")
  console.log()
  console.log(`snapshot: ${SNAPSHOT_GENERATED_AT} (${ageDays ?? "?"} days old), ${SNAPSHOT_MODELS.length} models`)
  console.log(`live:     ${live.length} models`)
  console.log()

  console.log("## Drift")
  console.log()
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log("No drift: the bundled snapshot matches the live endpoints.")
  } else {
    console.log(formatCounted("added", added))
    console.log(formatCounted("removed", removed))
    console.log(`- changed (${changed.length}):`)
    for (const entry of changed) {
      console.log(`    ${entry.id}`)
      for (const line of entry.changes) console.log(`      ${line}`)
    }
  }
  console.log()

  console.log("## Live capabilities")
  console.log()
  console.log(`- priced: ${liveCapabilities.priced}/${liveCapabilities.total}, unpriced models show $0`)
  console.log(`- image input: ${liveCapabilities.imageIds}, reasoning: ${liveCapabilities.reasoningIds}`)
  console.log(`- explicit thinking levels: ${liveCapabilities.explicitLevelCount}`)
  console.log(`- invalid contextWindow/maxTokens: ${liveCapabilities.invalidLimitsIds.length}`)
  console.log()

  console.log("## Quirk review")
  console.log()
  const makerLine = Object.entries(liveCapabilities.makers)
    .map(([maker, count]) => `${maker} ${count}`)
    .join(", ")
  console.log(`- makers: ${makerLine}`)
  console.log(`- new makers not in the snapshot: ${formatIds(newMakers)}`)
  console.log(formatCounted("DeepSeek workaround applies to", liveCapabilities.deepseekIds))
  console.log(formatCounted("models without a price", liveCapabilities.unpricedIds))
  console.log(formatCounted("models with a zero price field", liveCapabilities.zeroPriceIds))
  console.log(formatCounted("models advertising explicit thinking levels", liveCapabilities.explicitLevelIds))
  if (liveCapabilities.invalidLimitsIds.length > 0) {
    console.log(formatCounted("models with invalid limits", liveCapabilities.invalidLimitsIds))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
