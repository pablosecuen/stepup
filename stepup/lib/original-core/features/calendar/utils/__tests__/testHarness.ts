// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/testHarness.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import assertStrict from "node:assert/strict";
import { test as nodeTest } from "node:test";

// Arnés de pruebas del original (`testHarness.ts`) sobre node:test: mismas funciones (assert, assertEqual, assertThrows, test), mismas expectativas.
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Esperado: ${String(expected)}. Actual: ${String(actual)}.`);
}
export function assertThrows(run: () => void, matcher: RegExp | string, message: string): void {
  try {
    run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const matches = typeof matcher === "string" ? detail.includes(matcher) : matcher.test(detail);
    if (!matches) throw new Error(`${message}. Lanzó, pero el mensaje no coincide: "${detail}"`);
    return;
  }
  throw new Error(`${message}. No lanzó ningún error.`);
}
export function test(name: string, run: () => void | Promise<void>): void {
  nodeTest(name, async () => {
    await run();
  });
}
export function asyncTest(name: string, run: () => Promise<void>): void {
  nodeTest(name, async () => {
    await run();
  });
}
export async function runPendingAsyncTests(): Promise<void> {}
export function finishTests(_label?: string): void {}
export function assertStrictOk(value: unknown, message?: string): void {
  assertStrict.ok(value, message);
}
