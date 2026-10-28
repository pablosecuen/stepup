// Puerto VERBATIM del original (`src/features/calendar/utils/calendarActivityKind.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ActivityKind } from '../types/index.ts';

/**
 * Corrección 2026-09-05 (a pedido de Joaquín — TeacherFlow también debe
 * permitir gestionar Entrenamientos): fuente única de verdad para todo lo
 * que depende del tipo de actividad — normalización histórica, etiqueta
 * visible, y si admite el sistema de tareas pendientes. Ningún otro archivo
 * debe comparar `activityKind`/`form.activityKind` contra strings a mano
 * ('training'/'class') ni contra `undefined` — siempre a través de estas
 * funciones, para que un cambio futuro (agregar un tercer tipo, por
 * ejemplo) tenga un único lugar real que actualizar.
 */

/**
 * Toda serie/ocurrencia/registro anterior a esta fase (o cualquier valor
 * ausente/no reconocido) se interpreta como `'class'` — nunca una migración
 * destructiva, nunca se reescribe el dato persistido, sólo se normaliza en
 * memoria al leerlo.
 */
export function normalizeActivityKind(value: ActivityKind | string | null | undefined): ActivityKind {
  return value === 'training' ? 'training' : 'class';
}

export function activityKindLabel(value: ActivityKind | string | null | undefined): string {
  return normalizeActivityKind(value) === 'training' ? 'Entrenamiento' : 'Clase';
}

/**
 * Corrección 2026-09-05 (a pedido de Joaquín — TAREA PENDIENTE, "no repitas
 * el error anterior donde la validación bloqueaba algo que la interfaz no
 * permitía resolver"): único punto real que decide si un tipo de actividad
 * admite el sistema de tareas (sección visible, arrastre de tareas
 * anteriores, bloqueo de guardado por tarea sin resolver, recordatorios).
 * Sólo `'class'` admite tareas — un entrenamiento nunca las muestra, nunca
 * las exige, nunca las genera.
 */
export function activityKindSupportsHomework(value: ActivityKind | string | null | undefined): boolean {
  return normalizeActivityKind(value) === 'class';
}

/** Texto compacto para pastillas/badges (Calendario, historial) — nunca el texto largo de `activityKindLabel` en un espacio chico. */
export function activityKindCompactLabel(value: ActivityKind | string | null | undefined): string {
  return normalizeActivityKind(value) === 'training' ? 'Entren.' : 'Clase';
}

/**
 * Textos del flujo de "Registrar clase"/"Editar registro" que cambian según
 * el tipo — única fuente, nunca condicionales `kind === 'training' ? ... : ...`
 * repetidos por archivo.
 */
export interface ActivityKindRegistrationCopy {
  /** Título de la acción: "Registrar clase" / "Registrar entrenamiento". */
  registerAction: string;
  /** Fila "Resultado de la clase" / "Resultado del entrenamiento". */
  outcomeFieldLabel: string;
  /** Sección "Contenido pedagógico" / "Contenido del entrenamiento". */
  contentSectionTitle: string;
}

export function activityKindRegistrationCopy(value: ActivityKind | string | null | undefined): ActivityKindRegistrationCopy {
  if (normalizeActivityKind(value) === 'training') {
    return {
      registerAction: 'Registrar entrenamiento',
      outcomeFieldLabel: 'Resultado del entrenamiento',
      contentSectionTitle: 'Contenido del entrenamiento',
    };
  }
  return {
    registerAction: 'Registrar clase',
    outcomeFieldLabel: 'Resultado de la clase',
    contentSectionTitle: 'Contenido pedagógico',
  };
}
