// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/punctualityScoring.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentArrival } from '../../types/index.ts';
import { buildPunctualitySummary, computeClassPunctualityScore, PUNCTUALITY_CATEGORY_LABELS, type PunctualityScoreEntry } from '../punctualityScoring.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function arrival(overrides: Partial<StudentArrival>): StudentArrival {
  return { status: 'on_time', lateMinutes: 0, manuallyCorrected: false, ...overrides };
}

function entry(overrides: Partial<PunctualityScoreEntry> & { date: string }): PunctualityScoreEntry {
  return { arrival: arrival({}), isCancelled: false, isFuture: false, ...overrides };
}

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "ELIMINAR TOLERANCIA DE
 * PUNTUALIDAD"): `computeClassPunctualityScore`/`buildPunctualitySummary` ya
 * no reciben minutos de tolerancia — los umbrales de "late" ahora aplican
 * directamente sobre los minutos reales de demora (`lateMinutes`), nunca
 * sobre "minutos después de la tolerancia".
 */
test('computeClassPunctualityScore: a horario o dentro de tolerancia (opción manual) siempre 100', () => {
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'on_time' }) })), 100, 'a horario');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'within_grace', lateMinutes: 8 }) })), 100, 'dentro de tolerancia (elegida manualmente por la profesora)');
});

test('computeClassPunctualityScore: escala exacta de minutos reales de demora', () => {
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'late', lateMinutes: 10 }) })), 80, 'hasta 10 min de demora real');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'late', lateMinutes: 20 }) })), 60, 'entre 11 y 20 min de demora real');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'late', lateMinutes: 30 }) })), 35, 'entre 21 y 30 min de demora real');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'late', lateMinutes: 31 }) })), 10, 'más de 30 min de demora real');
});

test('computeClassPunctualityScore: ausencia atribuible al alumno es 0', () => {
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'no_show', lateMinutes: 0 }) })), 0, 'ausencia atribuible al alumno');
});

test('computeClassPunctualityScore: excluye unknown/teacher_delayed/mutual_adjustment (null, nunca 0)', () => {
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'unknown' }) })), null, 'nunca penaliza un registro pendiente');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'teacher_delayed' }) })), null, 'un atraso de la profesora nunca perjudica al alumno');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: arrival({ status: 'mutual_adjustment' }) })), null, 'un acuerdo mutuo nunca perjudica al alumno');
});

test('computeClassPunctualityScore: excluye clases canceladas, futuras o sin registro de llegada', () => {
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', isCancelled: true })), null, 'clase cancelada excluida');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', isFuture: true })), null, 'clase futura excluida');
  assertEqual(computeClassPunctualityScore(entry({ date: '2026-07-01', arrival: null })), null, 'registro incompleto excluido');
});

test('buildPunctualitySummary: con menos de 3 clases elegibles, "Historial insuficiente"', () => {
  const summary = buildPunctualitySummary([entry({ date: '2026-07-01' }), entry({ date: '2026-07-08' })]);
  assertEqual(summary.category, 'insuficiente', 'menos de 3 clases elegibles');
  assertEqual(PUNCTUALITY_CATEGORY_LABELS[summary.category], 'Historial insuficiente', 'texto exacto pedido');
});

test('buildPunctualitySummary: categorías según el promedio (90-100 excelente, 75-89 buena, 50-74 irregular, 0-49 impuntualidad)', () => {
  const excelente = buildPunctualitySummary(
    [1, 2, 3].map((day) => entry({ date: `2026-07-0${day}`, arrival: arrival({ status: 'on_time' }) }))
  );
  assertEqual(excelente.category, 'excelente', 'siempre a horario');

  const impuntual = buildPunctualitySummary(
    [1, 2, 3].map((day) => entry({ date: `2026-07-0${day}`, arrival: arrival({ status: 'late', lateMinutes: 60 }) }))
  );
  assertEqual(impuntual.category, 'impuntualidad_frecuente', 'siempre muy tarde');
});

test('buildPunctualitySummary: calcula % dentro de horario/tolerancia, demora promedio y cantidad de llegadas tarde', () => {
  const entries = [
    entry({ date: '2026-07-01', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-07-02', arrival: arrival({ status: 'within_grace', lateMinutes: 5 }) }),
    entry({ date: '2026-07-03', arrival: arrival({ status: 'late', lateMinutes: 20 }) }),
    entry({ date: '2026-07-04', arrival: arrival({ status: 'late', lateMinutes: 30 }) }),
  ];
  const summary = buildPunctualitySummary(entries);
  assertEqual(summary.evaluatedClasses, 4, 'cuatro clases elegibles');
  assertEqual(summary.onTimeOrGracePercent, 50, '2 de 4 dentro de horario/tolerancia');
  assertEqual(summary.lateArrivalsCount, 2, 'dos llegadas tarde');
  assertEqual(summary.averageLateMinutes, 25, 'promedio de demora sólo entre las tardías (20 y 30)');
});

test('buildPunctualitySummary: evolución mensual agrupa por mes real de la clase', () => {
  const entries = [
    entry({ date: '2026-06-01', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-06-10', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-07-01', arrival: arrival({ status: 'late', lateMinutes: 60 }) }),
  ];
  const summary = buildPunctualitySummary(entries);
  assertEqual(summary.monthlyEvolution.length, 2, 'dos meses distintos');
  assertEqual(summary.monthlyEvolution[0].monthKey, '2026-06', 'orden cronológico');
  assertEqual(summary.monthlyEvolution[0].averageScore, 100, 'junio: dos clases a horario');
  assertEqual(summary.monthlyEvolution[1].monthKey, '2026-07', 'segundo mes');
});

test('buildPunctualitySummary: excluye del cómputo unknown/teacher_delayed/mutual_adjustment/canceladas/futuras', () => {
  const entries = [
    entry({ date: '2026-07-01', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-07-02', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-07-03', arrival: arrival({ status: 'on_time' }) }),
    entry({ date: '2026-07-04', arrival: arrival({ status: 'teacher_delayed' }) }),
    entry({ date: '2026-07-05', arrival: arrival({ status: 'mutual_adjustment' }) }),
    entry({ date: '2026-07-06', arrival: arrival({ status: 'unknown' }) }),
    entry({ date: '2026-07-07', isCancelled: true }),
    entry({ date: '2099-01-01', isFuture: true }),
  ];
  const summary = buildPunctualitySummary(entries);
  assertEqual(summary.evaluatedClasses, 3, 'sólo las 3 clases realmente elegibles');
  assertEqual(summary.category, 'excelente', 'no se diluye con las excluidas');
});

test('PUNCTUALITY_CATEGORY_LABELS: textos exactos pedidos, siempre describe comportamiento registrado', () => {
  assertEqual(PUNCTUALITY_CATEGORY_LABELS.excelente, 'Excelente puntualidad', '90-100');
  assertEqual(PUNCTUALITY_CATEGORY_LABELS.buena, 'Buena puntualidad', '75-89');
  assertEqual(PUNCTUALITY_CATEGORY_LABELS.irregular, 'Puntualidad irregular', '50-74');
  assertEqual(PUNCTUALITY_CATEGORY_LABELS.impuntualidad_frecuente, 'Impuntualidad frecuente', '0-49');
});
