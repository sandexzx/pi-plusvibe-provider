/**
 * Rendering helpers for `GET /v1/balance`.
 *
 * The endpoint is not documented and the payload differs between gateway
 * revisions, so formatting is deliberately generic: known keys get a Russian
 * label, unknown ones are printed as-is, and nested objects are flattened with
 * dotted paths.
 */

const LABELS: Record<string, string> = {
  balance: "Баланс",
  amount: "Сумма",
  remaining: "Остаток",
  total: "Всего",
  used: "Израсходовано",
  spent: "Израсходовано",
  limit: "Лимит",
  currency: "Валюта",
  unit: "Единица",
  rub: "В рублях",
  usd: "В долларах",
  value: "Значение",
  tokens: "Токенов",
  requests: "Запросов",
  credit: "Кредит",
  credits: "Кредиты",
  user: "Пользователь",
  email: "Почта",
  plan: "Тариф",
  status: "Статус",
  bonus: "Бонус",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function label(path: string): string {
  if (path.length === 0) return ""
  const key = path.split(".").pop() ?? path
  return LABELS[key.toLowerCase()] ?? key
}

function formatValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") {
    const fixed = Number.isInteger(value) ? value.toString() : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
    return fixed
  }
  if (typeof value === "string") return value.trim().length > 0 ? value : undefined
  if (typeof value === "boolean") return value ? "да" : "нет"
  return undefined
}

function walk(value: unknown, path: string, lines: string[], depth: number): void {
  if (depth > 3 || lines.length > 60) return
  if (value === null || value === undefined) return

  const scalar = formatValue(value)
  if (scalar !== undefined) {
    // A bare scalar at the root has no key to label it with.
    lines.push(path.length === 0 ? scalar : `${label(path)}: ${scalar}`)
    return
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path ? `${path}.${key}` : key, lines, depth + 1)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, lines, depth + 1))
    return
  }

  const serialized = JSON.stringify(value)
  if (serialized) lines.push(`${label(path)}: ${serialized}`)
}

/** Flatten a balance payload into human-readable `label: value` lines. */
export function formatBalance(data: unknown): string[] {
  const lines: string[] = []
  walk(data, "", lines, 0)
  return lines.length > 0 ? lines : [JSON.stringify(data)]
}
