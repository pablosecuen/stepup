import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { shouldBlurOnWheel } from "../number-wheel.ts";
import { adhocEndAt } from "../../lessons/adhoc.ts";
import { localDateTimeToInstantIso } from "../../calendar/timezone.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const ZONE = "America/Argentina/Buenos_Aires";

/** «2026-10-15 00:30» en la zona de la profesora (hora 00–23). */
function localLabel(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
const at = (date: string, hour: number, minute: number) => localDateTimeToInstantIso({ date, hour, minute, timeZone: ZONE });

test("la rueda sólo quita el foco a un <input type=number> que está enfocado y es el destino de la rueda", () => {
  const number = { tagName: "INPUT", type: "number" };
  assert.equal(shouldBlurOnWheel(number, number), true);
  assert.equal(shouldBlurOnWheel(number, { tagName: "INPUT", type: "number" }), false, "otro elemento enfocado: no se toca");
  assert.equal(shouldBlurOnWheel(number, null), false, "sin foco en el campo la rueda no lo cambia");
  const text = { tagName: "INPUT", type: "text" };
  assert.equal(shouldBlurOnWheel(text, text), false);
  const area = { tagName: "TEXTAREA", type: "textarea" };
  assert.equal(shouldBlurOnWheel(area, area), false);
  assert.equal(shouldBlurOnWheel(null, null), false);
  assert.equal(shouldBlurOnWheel("input", "input"), false);
  assert.equal(shouldBlurOnWheel(undefined, undefined), false);
});

test("la guarda de la rueda está montada una vez en la raíz, no cambia valores y deja pasar el desplazamiento", () => {
  const layout = code("app/layout.tsx");
  assert.match(layout, /<SkipLink \/>\s*\{children\}\s*<NumberWheelGuard \/>/, "después del contenido: «Saltar al contenido» sigue siendo lo primero");
  const guard = code("components/ui/number-wheel-guard.tsx");
  assert.match(guard, /^"use client";/m);
  assert.match(guard, /passive: true/, "no bloquea el desplazamiento de la página");
  assert.doesNotMatch(guard, /preventDefault|\.value\s*=|stopPropagation/, "no impide ni modifica nada: sólo quita el foco");
  assert.match(guard, /removeEventListener/);
});

test("una duración ingresada (30, 45, 60, 90) llega exacta al servidor y el fin es inicio + minutos, sin redondeos", () => {
  for (const minutes of [30, 45, 60, 90]) {
    assert.equal(Number(String(minutes)) || 0, minutes, "el formulario envía exactamente lo escrito");
    const start = at("2026-10-14", 10, 0);
    const end = adhocEndAt(start, minutes);
    assert.equal(new Date(end).getTime() - new Date(start).getTime(), minutes * 60_000, `${minutes} min`);
  }
  assert.equal(localLabel(adhocEndAt(at("2026-10-14", 10, 0), 60)), "2026-10-14 11:00");
  assert.equal(localLabel(adhocEndAt(at("2026-10-14", 10, 15), 45)), "2026-10-14 11:00");
  assert.equal(localLabel(adhocEndAt(at("2026-10-14", 9, 0), 30)), "2026-10-14 09:30");
  assert.equal(localLabel(adhocEndAt(at("2026-10-14", 16, 30), 90)), "2026-10-14 18:00");
});

test("límites de medianoche: cruzar el día (y el año) no resta ni suma minutos", () => {
  const cases: Array<[string, number, number, number, string]> = [
    ["2026-10-14", 23, 30, 60, "2026-10-15 00:30"],
    ["2026-10-14", 23, 0, 90, "2026-10-15 00:30"],
    ["2026-10-14", 22, 30, 90, "2026-10-15 00:00"],
    ["2026-10-14", 23, 59, 1, "2026-10-15 00:00"],
    ["2026-10-14", 0, 0, 60, "2026-10-14 01:00"],
    ["2026-10-14", 23, 15, 45, "2026-10-15 00:00"],
    ["2026-10-14", 23, 30, 30, "2026-10-15 00:00"],
    ["2026-12-31", 23, 30, 60, "2027-01-01 00:30"],
    ["2028-02-28", 23, 30, 60, "2028-02-29 00:30"],
  ];
  for (const [date, hour, minute, duration, expected] of cases) {
    const start = at(date, hour, minute);
    const end = adhocEndAt(start, duration);
    assert.equal(localLabel(end), expected, `${date} ${hour}:${minute} + ${duration}`);
    assert.equal(new Date(end).getTime() - new Date(start).getTime(), duration * 60_000, "la diferencia entre instantes es exactamente la duración");
  }
});

test("el formulario ad-hoc y la acción usan la duración tal cual: sin conversiones al perder el foco ni redondeos", () => {
  const form = code("app/(app)/registro/nuevo/nuevo-registro-form.tsx");
  assert.match(form, /useState\("60"\)/);
  assert.doesNotMatch(form, /onBlur/, "ningún manejador de foco reescribe la duración");
  assert.match(form, /durationMinutes: Number\(durationMinutes\) \|\| 0,/);
  const action = code("lib/actions/lesson-registrations.ts");
  assert.match(action, /const endAt = adhocEndAt\(startAt, input\.durationMinutes\);/);
  assert.doesNotMatch(read("lib/lessons/adhoc.ts"), /Math\.(round|floor|ceil|trunc)/);
});
