import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  catalogOrigin,
  describeGateway,
  GATEWAYS,
  gatewaySwitchHint,
  otherGateway,
  readGateway,
  resolveGateway,
  writeGateway,
} from "../src/gateway.ts"
import { SNAPSHOT_MODELS } from "../src/catalog-snapshot.ts"
import { toProviderModels } from "../src/models.ts"
import { fetchCatalog, fetchPiModels } from "../src/api.ts"

const dir = mkdtempSync(join(tmpdir(), "plusvibe-gateway-"))
const path = join(dir, "nested", "gateway.json")
try {
  assert.equal(readGateway(path), "main")
  for (const gateway of ["main", "mirror"] as const) {
    writeGateway(path, gateway)
    assert.equal(readGateway(path), gateway)
    assert.deepEqual(readdirSync(join(dir, "nested")), ["gateway.json"])
  }
  for (const invalid of ["garbage", "null", "[]", '{"gateway":"unknown"}']) {
    writeFileSync(path, invalid)
    assert.equal(readGateway(path), "main")
  }
  assert.equal(readGateway(dir), "main")
  // A failed atomic rename must propagate and clean up its temporary file.
  assert.throws(() => writeGateway(join(dir, "nested"), "mirror"))
  assert.deepEqual(readdirSync(dir), ["nested"])
  assert.equal(readGateway(path), "main")
  writeGateway(path, "mirror")
  assert.deepEqual(resolveGateway({}, path), { kind: "named", gateway: "mirror", baseUrl: GATEWAYS.mirror })
  assert.deepEqual(resolveGateway({ PLUSVIBE_BASE_URL: "  https://proxy.example/v1///  " }, path), {
    kind: "env", baseUrl: "https://proxy.example/v1",
  })
  assert.equal(resolveGateway({ PLUSVIBE_BASE_URL: "  " }, path).baseUrl, GATEWAYS.mirror)
  assert.equal(catalogOrigin(resolveGateway({}, path)), "https://gw.plusvibeapi.ru")
  assert.equal(catalogOrigin(resolveGateway({ PLUSVIBE_BASE_URL: "https://proxy.example/v1" }, path)), "https://plusvibeapi.ru")
  writeGateway(path, "main")
  assert.equal(catalogOrigin(resolveGateway({}, path)), "https://plusvibeapi.ru")
  const claude = toProviderModels(SNAPSHOT_MODELS, { rubPerUsd: 0, baseUrl: GATEWAYS.mirror })
    .filter(model => model.api === "anthropic-messages")
  assert.ok(claude.length > 0)
  for (const model of claude) assert.equal(model.baseUrl, "https://gw.plusvibeapi.ru")
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (url) => {
    urls.push(String(url))
    return new Response("{}", { status: 200 })
  }
  await fetchPiModels({ origin: "https://gw.plusvibeapi.ru", fetchImpl })
  await fetchCatalog({ origin: "https://gw.plusvibeapi.ru", fetchImpl })
  await fetchCatalog({ fetchImpl })
  assert.deepEqual(urls, [
    "https://gw.plusvibeapi.ru/api/integrations/pi.models.json",
    "https://gw.plusvibeapi.ru/api/catalog",
    "https://plusvibeapi.ru/api/catalog",
  ])
  assert.equal(otherGateway("main"), "mirror")
  assert.equal(otherGateway("mirror"), "main")
  assert.equal(describeGateway("mirror"), "зеркало (gw.plusvibeapi.ru)")
  assert.equal(describeGateway("main"), "основной шлюз (plusvibeapi.ru)")
  assert.match(gatewaySwitchHint({ kind: "named", gateway: "main", baseUrl: GATEWAYS.main }) ?? "", /gw\.plusvibeapi\.ru/)
  assert.equal(gatewaySwitchHint({ kind: "env", baseUrl: "https://proxy.example/v1" }), undefined)
  console.log("Gateway tests passed")
} finally {
  rmSync(dir, { recursive: true, force: true })
}
