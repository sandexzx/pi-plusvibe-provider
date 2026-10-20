import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { DEFAULT_BASE_URL, ENV_BASE_URL, FALLBACK_BASE_URL } from "./catalog.ts"

export type Gateway = "main" | "mirror"
export const GATEWAYS: Record<Gateway, string> = { main: DEFAULT_BASE_URL, mirror: FALLBACK_BASE_URL }

export function gatewayFilePath(): string {
  return join(homedir(), ".config", "plusvibe", "gateway.json")
}

export function readGateway(path: string): Gateway {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    return value !== null && typeof value === "object" && "gateway" in value && value.gateway === "mirror"
      ? "mirror" : "main"
  } catch {
    return "main"
  }
}

export function writeGateway(path: string, gateway: Gateway): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ gateway }, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch { /* Already renamed or never created. */ }
  }
}

export type ResolvedGateway =
  | { kind: "env"; baseUrl: string }
  | { kind: "named"; gateway: Gateway; baseUrl: string }

export function resolveGateway(env: Record<string, string | undefined>, path: string): ResolvedGateway {
  const custom = env[ENV_BASE_URL]?.trim()
  if (custom) return { kind: "env", baseUrl: custom.replace(/\/+$/, "") }
  const gateway = readGateway(path)
  return { kind: "named", gateway, baseUrl: GATEWAYS[gateway] }
}

/** Public catalogs follow named gateways; custom proxies retain the main catalog. */
export function catalogOrigin(resolved: ResolvedGateway): string {
  return new URL(resolved.kind === "named" ? GATEWAYS[resolved.gateway] : DEFAULT_BASE_URL).origin
}

const GATEWAY_LABELS: Record<Gateway, string> = { main: "основной шлюз", mirror: "зеркало" }

/** The gateway `/plusvibe-gateway` switches to from the current one. */
export function otherGateway(gateway: Gateway): Gateway {
  return gateway === "main" ? "mirror" : "main"
}

/** Human-readable gateway name with its host, e.g. "зеркало (gw.plusvibeapi.ru)". */
export function describeGateway(gateway: Gateway): string {
  return `${GATEWAY_LABELS[gateway]} (${new URL(GATEWAYS[gateway]).host})`
}

/**
 * A hint shown when the gateway could not be reached at all.
 *
 * Only for named gateways: a custom `PLUSVIBE_BASE_URL` is the user's own
 * choice, and the command refuses to switch while it is set.
 */
export function gatewaySwitchHint(resolved: ResolvedGateway): string | undefined {
  if (resolved.kind !== "named") return undefined
  return `Сервер не отвечает? Выполните /plusvibe-gateway, чтобы переключиться на ${describeGateway(otherGateway(resolved.gateway))}.`
}
