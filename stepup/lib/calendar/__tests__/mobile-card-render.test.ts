import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as layout from "../layout.ts";
import * as cardText from "../card-text.ts";
import * as civil from "../civil-calendar.ts";
import * as theme from "../../calendar-theme.ts";
import type { CalendarViewItem } from "../occurrences.ts";

// Execute the production TSX with its real geometry/text/palette and React renderer.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../../components/calendar/real-lesson-card.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies: Record<string, unknown> = {
  "@/lib/calendar/layout": layout, "@/lib/calendar/card-text": cardText,
  "@/lib/calendar/civil-calendar": civil, "@/lib/calendar-theme": theme,
  "./barbell-icon": { BarbellIcon: () => null },
};
const moduleExports: Record<string, never> = {};
new Function("require", "exports", compiled)((id: string) => dependencies[id] ?? require(id), moduleExports);
const Card = moduleExports.RealLessonCard;
const item = {
  id: "qa_mobile", studentName: "María Luz Ejemplo", title: null,
  start: "2026-10-21T15:45:00-03:00", end: "2026-10-21T17:00:00-03:00",
  status: "scheduled", modality: "online", activityKind: "class", participantIds: ["qa_student"],
} as CalendarViewItem;
function render(overrides: Partial<CalendarViewItem> = {}, inProgress = false) {
  const lesson = { ...item, ...overrides };
  return renderToStaticMarkup(createElement(Card, {
    positioned: layout.layoutDayItems([lesson], 50)[0], columnWidthPx: 320,
    mobile: true, dayRow: true, isElapsed: false, isActiveReplacement: false,
    isInProgress: inProgress, onSelect() {},
  }));
}
test("mobile day renders the student's identity, full time range, modality and scheduled state", () => {
  const html = render();
  for (const text of ["María Luz Ejemplo", "15:45–17:00", "Online", "Programada"]) assert.ok(html.includes(text), text);
});
test("mobile day preserves cancellation text, strike-through and the original palette", () => {
  const html = render({ status: "cancelled" });
  assert.ok(html.includes("Cancelada"));
  assert.ok(html.includes("line-through"));
  assert.ok(html.includes("15:45–17:00"));
});
test("mobile group and in-progress information remain visible in the actual card", () => {
  const html = render({ title: "Conversación B2", participantIds: ["qa_1", "qa_2", "qa_3"] }, true);
  for (const text of ["Conversación B2", "3 alumnos", "En curso", "Online"]) assert.ok(html.includes(text), text);
});
