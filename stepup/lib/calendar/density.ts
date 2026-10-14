/**
 * Densidad de la grilla horaria del Calendario (escritorio, vistas Semana y Día): cuántos píxeles ocupa cada hora. Sólo cambia la
 * ESCALA VERTICAL: las fechas, las horas, las duraciones y la posición temporal de cada clase son las mismas (la posición y el alto
 * del bloque salen de minutos × px/hora; la zona interactiva de 44 px sigue siendo independiente de la geometría visible).
 *
 * La preferencia es de ese navegador (`localStorage`, nunca la base): un valor ausente, ilegible o inválido vuelve a «Media».
 */
export type CalendarDensityKey = "compact" | "medium" | "wide";

export interface CalendarDensity {
  readonly key: CalendarDensityKey;
  readonly label: string;
  readonly hourHeightPx: number;
}

export const CALENDAR_DENSITIES: readonly CalendarDensity[] = [
  { key: "compact", label: "Compacta", hourHeightPx: 48 },
  { key: "medium", label: "Media", hourHeightPx: 64 },
  { key: "wide", label: "Amplia", hourHeightPx: 80 },
];

export const DEFAULT_CALENDAR_DENSITY: CalendarDensityKey = "medium";
export const CALENDAR_DENSITY_STORAGE_KEY = "teacherflow.calendar.density.v1";

/** Valor guardado → densidad. Cualquier cosa que no sea exactamente una de las tres claves vuelve a «Media». */
export function parseCalendarDensity(raw: unknown): CalendarDensityKey {
  return CALENDAR_DENSITIES.some((density) => density.key === raw) ? (raw as CalendarDensityKey) : DEFAULT_CALENDAR_DENSITY;
}

export function hourHeightFor(key: CalendarDensityKey): number {
  return (CALENDAR_DENSITIES.find((density) => density.key === key) ?? CALENDAR_DENSITIES[1]).hourHeightPx;
}

/** Lectura segura del navegador: el almacenamiento puede faltar, estar bloqueado (modo privado) o lanzar. */
export function readStoredCalendarDensity(storage: Pick<Storage, "getItem"> | null | undefined): CalendarDensityKey {
  try {
    return parseCalendarDensity(storage?.getItem(CALENDAR_DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_CALENDAR_DENSITY;
  }
}

export function writeStoredCalendarDensity(storage: Pick<Storage, "setItem"> | null | undefined, key: CalendarDensityKey): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CALENDAR_DENSITY_STORAGE_KEY, key);
    return true;
  } catch {
    return false; // sin almacenamiento: la elección vale para esta pantalla y no se guarda
  }
}
