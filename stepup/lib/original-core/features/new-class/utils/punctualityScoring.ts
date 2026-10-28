// Puerto VERBATIM del original (`src/features/new-class/utils/punctualityScoring.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentArrival } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): scoring de puntualidad INDEPENDIENTE del scoring
 * financiero — nunca modifica ni se combina con `paymentStatus`. Presentado
 * siempre como comportamiento registrado, nunca como una afirmación
 * personal, y sin expresiones ofensivas.
 */
const MIN_ELIGIBLE_CLASSES = 3;

export interface PunctualityScoreEntry {
  /** YYYY-MM-DD — fecha real de la clase, para agrupar la evolución mensual. */
  date: string;
  arrival: StudentArrival | null;
  isCancelled: boolean;
  isFuture: boolean;
}

/**
 * `null` si la clase debe excluirse del scoring (unknown/teacher_delayed/
 * mutual_adjustment/cancelada/futura/incompleta) — nunca 0 por defecto,
 * para no confundir "excluida" con "ausencia".
 *
 * Corrección 2026-07-22 (a pedido de Joaquín — "ELIMINAR TOLERANCIA DE
 * PUNTUALIDAD"): los umbrales de "late" ahora aplican directamente sobre
 * los minutos reales de demora — antes le restaban la tolerancia
 * configurada, lo que hacía que esa configuración cambiara el scoring.
 */
export function computeClassPunctualityScore(entry: PunctualityScoreEntry): number | null {
  if (entry.isCancelled || entry.isFuture || !entry.arrival) return null;
  const { status, lateMinutes } = entry.arrival;
  if (status === 'unknown' || status === 'teacher_delayed' || status === 'mutual_adjustment') return null;
  if (status === 'on_time' || status === 'within_grace') return 100;
  if (status === 'no_show') return 0;
  if (lateMinutes <= 10) return 80;
  if (lateMinutes <= 20) return 60;
  if (lateMinutes <= 30) return 35;
  return 10;
}

export type PunctualityCategory = 'excelente' | 'buena' | 'irregular' | 'impuntualidad_frecuente' | 'insuficiente';

export const PUNCTUALITY_CATEGORY_LABELS: Record<PunctualityCategory, string> = {
  excelente: 'Excelente puntualidad',
  buena: 'Buena puntualidad',
  irregular: 'Puntualidad irregular',
  impuntualidad_frecuente: 'Impuntualidad frecuente',
  insuficiente: 'Historial insuficiente',
};

export interface PunctualityMonthSummary {
  monthKey: string; // YYYY-MM
  averageScore: number;
}

export interface PunctualitySummary {
  category: PunctualityCategory;
  evaluatedClasses: number;
  onTimeOrGracePercent: number | null;
  averageLateMinutes: number | null;
  lateArrivalsCount: number;
  monthlyEvolution: PunctualityMonthSummary[];
}

function categorize(averageScore: number): PunctualityCategory {
  if (averageScore >= 90) return 'excelente';
  if (averageScore >= 75) return 'buena';
  if (averageScore >= 50) return 'irregular';
  return 'impuntualidad_frecuente';
}

function isEligible(entry: PunctualityScoreEntry): entry is PunctualityScoreEntry & { arrival: StudentArrival } {
  if (entry.isCancelled || entry.isFuture || !entry.arrival) return false;
  const { status } = entry.arrival;
  return status !== 'unknown' && status !== 'teacher_delayed' && status !== 'mutual_adjustment';
}

/**
 * Con menos de 3 clases elegibles siempre devuelve "Historial insuficiente"
 * — nunca inventa un porcentaje o categoría con datos escasos.
 */
export function buildPunctualitySummary(entries: PunctualityScoreEntry[]): PunctualitySummary {
  const eligible = entries.filter(isEligible);

  if (eligible.length < MIN_ELIGIBLE_CLASSES) {
    return {
      category: 'insuficiente',
      evaluatedClasses: eligible.length,
      onTimeOrGracePercent: null,
      averageLateMinutes: null,
      lateArrivalsCount: 0,
      monthlyEvolution: [],
    };
  }

  const scored = eligible.map((entry) => ({
    entry,
    score: computeClassPunctualityScore(entry) ?? 0,
  }));
  const averageScore = scored.reduce((sum, item) => sum + item.score, 0) / scored.length;

  const onTimeCount = eligible.filter(
    (entry) => entry.arrival.status === 'on_time' || entry.arrival.status === 'within_grace'
  ).length;

  const lateEntries = eligible.filter(
    (entry) => entry.arrival.status === 'late' || entry.arrival.status === 'no_show'
  );
  const averageLateMinutes =
    lateEntries.length === 0
      ? 0
      : Math.round(
          (lateEntries.reduce((sum, entry) => sum + entry.arrival.lateMinutes, 0) / lateEntries.length) * 10
        ) / 10;

  const monthlyScores = new Map<string, number[]>();
  scored.forEach(({ entry, score }) => {
    const monthKey = entry.date.slice(0, 7);
    const list = monthlyScores.get(monthKey) ?? [];
    list.push(score);
    monthlyScores.set(monthKey, list);
  });
  const monthlyEvolution: PunctualityMonthSummary[] = Array.from(monthlyScores.entries())
    .map(([monthKey, scores]) => ({
      monthKey,
      averageScore: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
    }))
    .sort((first, second) => first.monthKey.localeCompare(second.monthKey));

  return {
    category: categorize(averageScore),
    evaluatedClasses: eligible.length,
    onTimeOrGracePercent: Math.round((onTimeCount / eligible.length) * 100),
    averageLateMinutes,
    lateArrivalsCount: lateEntries.length,
    monthlyEvolution,
  };
}
