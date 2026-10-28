// Puerto VERBATIM del original (`src/features/new-class/utils/punctualityStats.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Re-exporta el motor de puntualidad para consumidores fuera de
 * `new-class` (como `features/reportes`) que no deben tener la palabra
 * "scoring" en su propio código fuente — esa palabra está reservada para
 * el scoring financiero de pagos, y "Puntualidad y asistencia" en los
 * informes debe quedar completamente separada de esos datos.
 */
export { buildPunctualitySummary, PUNCTUALITY_CATEGORY_LABELS } from './punctualityScoring.ts';
export type { PunctualityScoreEntry, PunctualitySummary, PunctualityCategory } from './punctualityScoring.ts';
