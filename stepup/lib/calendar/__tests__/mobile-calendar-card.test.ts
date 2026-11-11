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
import { planMobileDay } from "../mobile-short-labels.ts";
import type { CalendarViewItem } from "../occurrences.ts";
import type { MobileCalendarCard } from "../../../components/calendar/mobile-calendar-card";
const require = createRequire(import.meta.url);
const dependencies: Record<string, unknown> = { "@/lib/calendar/layout": layout, "@/lib/calendar/card-text": cardText, "@/lib/calendar/civil-calendar": civil, "@/lib/calendar-theme": theme, "./barbell-icon": { BarbellIcon: () => null } };
function load(file: string) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL(`../../../components/calendar/${file}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)((id: string) => dependencies[id] ?? require(id), exports);
  return exports;
}
dependencies["./real-lesson-card"] = load("real-lesson-card");
const Card = load("mobile-calendar-card").MobileCalendarCard as typeof MobileCalendarCard;
const base = { id: "qa", studentName: "Alejandro Pons Estel", title: null, start: "2026-11-11T17:00:00-03:00", end: "2026-11-11T18:00:00-03:00", participantIds: ["qa"], modality: "online", status: "scheduled", activityKind: "class" } as CalendarViewItem;
function render(item: CalendarViewItem, dayView = false) {
  const positioned = layout.layoutDayItems([item], 50)[0];
  const title = item.title?.trim() || item.studentName;
  const stateText = cardText.compactStateTag({ status: item.status, isElapsed: false, isActiveReplacement: false, isInProgress: false, closedOutcome: item.closedOutcome }, true);
  const plan = planMobileDay([positioned], new Map([[item.id, { id: item.id, title, timeText: "", stateText }]]), dayView ? 354 : 71, 700, dayView);
  const text = plan.cards.get(item.id);
  assert.ok(text, `${title}: entra en su bloque (si no, se dibuja como barra + rótulo)`);
  return renderToStaticMarkup(createElement(Card, { positioned, text, dayView, isElapsed: false, isActiveReplacement: false, isInProgress: false, onSelect() {} }));
}
test("mobile identity stays complete, with time in the accessible label but no repeated visible hour", () => {
  const html = render(base);
  assert.match(html, /aria-label="Alejandro Pons Estel, 17:00, 60 minutos/);
  assert.match(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /Alejandro Pons Estel/, "el nombre completo, en palabras enteras");
  assert.doesNotMatch(html.replace(/aria-label="[^"]*"/g, ""), /17:00|…|truncate/);
  assert.match(html, /whitespace-nowrap/, "cada línea ya viene partida por palabras: nada se corta por letras");
  assert.match(html, /height:48px/, "the visible block keeps the true duration less its original gap");
});
test("PET A is centered without a participant-count label; day cards have a bounded width and 16px names", () => {
  const group = render({ ...base, title: "PET A", participantIds: ["a", "b", "c"] });
  assert.match(group, /PET A/);
  assert.doesNotMatch(group, /3 alumnos/);
  assert.match(group, /items-center text-center/, "los grupos van centrados");
  const day = render(base, true);
  assert.match(day, /max-width:244px/);
  assert.match(day, /font-size:16px/);
  assert.match(render({ ...base, title: "PET A", participantIds: ["a", "b", "c"] }, true), /items-center text-center/, "en Día el grupo también queda centrado");
});
test("a not-held result retains the status indicator and a cancelled card remains struck through, with its state in text (never only colour)", () => {
  const cancelled = render({ ...base, studentName: "Ana Pons", status: "cancelled" });
  assert.match(cancelled, /line-through/);
  assert.match(cancelled, />Cancel\.</, "el estado se dice con texto");
  assert.match(render({ ...base, studentName: "Ana Pons", status: "rescheduled" }), />Reprog\.</);
  assert.match(render({ ...base, studentName: "Ana Pons", status: "completed", closedOutcome: "cancelada_tarde" }), /repeating-linear-gradient/);
});
