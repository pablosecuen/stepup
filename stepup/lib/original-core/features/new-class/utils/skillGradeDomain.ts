// Puerto VERBATIM del original (`src/features/new-class/utils/skillGradeDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Skill, SkillGrades } from '../types/index.ts';

/**
 * Corrección P0 2026-08-19 (a pedido de Joaquín — "NOTAS POR ÁREA ASIGNA 5
 * ACCIDENTALMENTE"): funciones puras reales usadas por `SkillGradeChips.tsx`
 * — separadas para poder probarlas directamente (el proyecto no tiene
 * infraestructura de montaje de componentes React, así que la lógica real
 * de negocio vive acá, nunca sólo inline en el `.tsx`).
 *
 * CORRECCIÓN (a pedido de Joaquín — "error dependiente del alumno": algunos
 * sliders se sienten bloqueados según el registro abierto): la investigación
 * descartó una diferencia de DATOS entre alumnos (el guardado ya es
 * inmutable y correcto por alumno/área — ver `useNewClassForm.ts`) — la
 * causa real fue de RENDER, no de dato (ver `SkillGradeChips.tsx`). Aun así,
 * se agrega acá `normalizeSkillGradeValue` como la ÚNICA normalización
 * canónica del valor editable, para blindar el camino de lectura contra un
 * registro histórico inválido (string, NaN, fuera de rango) sin borrar
 * nunca el registro — nunca se ejecutó antes ninguna validación de tipo en
 * el camino normal de carga (ver `restoreValidation.ts`, que sólo valida en
 * la restauración de respaldos, no al abrir un registro guardado).
 */

/**
 * Normaliza CUALQUIER valor persistido de una nota por área (incluido uno
 * histórico inválido) al tipo canónico: un entero 1-10, o `null` si no hay
 * nota real (ausente, `undefined`, `null`, `0`, `NaN`, fuera de rango, o un
 * texto no numérico). Nunca lanza, nunca borra el registro — sólo decide
 * cómo INTERPRETARLO al mostrarlo o editarlo. Idempotente: normalizar un
 * valor ya normalizado devuelve el mismo valor.
 */
export function normalizeSkillGradeValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  const clamped = Math.max(0, Math.min(10, rounded));
  return clamped === 0 ? null : clamped;
}

/**
 * Traduce el valor crudo del slider (0-10, con decimales posibles mientras
 * se arrastra) al valor real que corresponde persistir: 0 significa
 * "Sin calificar" — nunca una nota real — así que se traduce a `null`
 * (misma convención que ya usaba el chip al desactivarse). Cualquier otro
 * valor se redondea al entero más cercano dentro de 1-10. Reutiliza
 * `normalizeSkillGradeValue` — misma normalización canónica que el camino
 * de lectura, nunca una segunda regla paralela.
 */
export function resolveSkillGradeSliderValue(sliderValue: number): number | null {
  return normalizeSkillGradeValue(sliderValue);
}

/**
 * Universo inicial de áreas que deben arrancar expandidas (mostrando su
 * slider) — exactamente las que ya tienen una nota real (1-10) al montar
 * el componente, para que una calificación cargada desde antes siga
 * visible sin necesitar un toque extra. Nunca incluye un área sin nota:
 * abrir el formulario, o cualquier otra área con valor ausente/0/inválido,
 * arranca colapsada.
 */
export function computeInitiallyExpandedSkills(skills: Skill[], values: SkillGrades): Skill[] {
  return skills.filter((skill) => normalizeSkillGradeValue(values[skill]) !== null);
}
