// Aviso diario de cobros: reglas de aparición del original (copia idéntica) sobre el resumen de la web, con el guardado en el dispositivo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildDismissedNoticeState, shouldShowDailyCollectionsNotice } from "../../payments/engine/features/payments/utils/dailyCollectionsNotice.ts";
import { parseStoredNotice, worstNoticeRank } from "../daily-collections-notice.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-28";

test("sin cobros que vencen hoy ni vencidos no hay aviso; vencido es más grave que «vence hoy»", () => {
  assert.equal(worstNoticeRank({ dueToday: 0, overdueCount: 0 }), null);
  const dueToday = worstNoticeRank({ dueToday: 2, overdueCount: 0 });
  const overdue = worstNoticeRank({ dueToday: 2, overdueCount: 1 });
  assert.ok(dueToday !== null && overdue !== null && overdue < dueToday, "rango menor = más urgente");
});

test("circuito del aviso: aparece, «Recordarme mañana» lo oculta hoy, vuelve mañana y vuelve antes sólo si empeora", () => {
  const dueTodayRank = worstNoticeRank({ dueToday: 1, overdueCount: 0 });
  const overdueRank = worstNoticeRank({ dueToday: 1, overdueCount: 3 });
  assert.equal(shouldShowDailyCollectionsNotice({ today: TODAY, worstUrgencyRank: dueTodayRank, persisted: null }), true, "primera apertura del día");
  const dismissed = buildDismissedNoticeState({ today: TODAY, worstUrgencyRank: dueTodayRank! });
  assert.equal(shouldShowDailyCollectionsNotice({ today: TODAY, worstUrgencyRank: dueTodayRank, persisted: dismissed }), false, "descartado hoy y sin cambios");
  assert.equal(shouldShowDailyCollectionsNotice({ today: TODAY, worstUrgencyRank: worstNoticeRank({ dueToday: 5, overdueCount: 0 }), persisted: dismissed }), false, "más cobros en la misma etapa no cuentan como peor");
  assert.equal(shouldShowDailyCollectionsNotice({ today: TODAY, worstUrgencyRank: overdueRank, persisted: dismissed }), true, "empeoró: pasó a vencido");
  assert.equal(shouldShowDailyCollectionsNotice({ today: "2026-10-29", worstUrgencyRank: dueTodayRank, persisted: dismissed }), true, "al día siguiente vuelve");
  assert.equal(shouldShowDailyCollectionsNotice({ today: TODAY, worstUrgencyRank: null, persisted: null }), false, "se oculta apenas no queda nada que atender");
});

test("lo guardado en el dispositivo se valida: un valor roto o alterado nunca oculta el aviso", () => {
  const good = JSON.stringify(buildDismissedNoticeState({ today: TODAY, worstUrgencyRank: 3 }));
  assert.deepEqual(parseStoredNotice(good), { dismissedOnDate: TODAY, dismissedWorstUrgencyRank: 3 });
  for (const bad of [null, "", "{", "[]", "null", '{"dismissedOnDate":"hoy","dismissedWorstUrgencyRank":3}', '{"dismissedOnDate":"2026-10-28","dismissedWorstUrgencyRank":99}', '{"dismissedOnDate":"2026-10-28","dismissedWorstUrgencyRank":"3"}', '{"dismissedOnDate":"2026-10-28","dismissedWorstUrgencyRank":1.5}']) {
    assert.equal(parseStoredNotice(bad), null, String(bad));
  }
});

test("cableado: Inicio muestra el aviso con «Ver cobros» y «Recordarme mañana», sin nombres ni importes, y tolera que el navegador no guarde", () => {
  const view = read("components/dashboard/home-view.tsx");
  assert.match(view, /<DailyCollectionsNotice summary=\{data\.collectionsUrgency\} todayDateKey=\{data\.todayDateKey\} \/>/);
  const notice = read("components/dashboard/daily-collections-notice.tsx");
  assert.match(notice, /Recordarme mañana/);
  assert.match(notice, /Ver cobros/);
  assert.match(notice, /Cobros que requieren atención/);
  assert.doesNotMatch(notice, /formatMoney|studentName|balance|amount/);
  assert.match(notice, /try \{\s*window\.localStorage\.setItem/, "guardar puede fallar (modo privado): nunca rompe");
});
