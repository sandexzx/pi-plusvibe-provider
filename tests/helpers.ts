/**
 * Minimal zero-dependency test harness.
 *
 * Tests are registered in declaration order and executed sequentially by
 * `run()`, so async cases (fake fetches, awaiting handlers) are safe.
 */

type TestFn = () => unknown | Promise<unknown>

interface TestCase {
  name: string
  fn: TestFn
}

const cases: TestCase[] = []

export function test(name: string, fn: TestFn): void {
  cases.push({ name, fn })
}

export async function run(): Promise<void> {
  let failed = 0
  for (const item of cases) {
    try {
      await item.fn()
      console.log(`  ok  ${item.name}`)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      console.error(`FAIL  ${item.name}\n${message}`)
    }
  }

  console.log(`${cases.length - failed}/${cases.length} passed`)
  if (failed > 0) process.exit(1)
}
