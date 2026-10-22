/**
 * Densidad de la grilla horaria del Calendario (escritorio, vistas Semana y Día): cuántos píxeles ocupa cada hora. Sólo cambia la
 * ESCALA VERTICAL: las fechas, las horas, las duraciones y la posición temporal de cada clase son las mismas (la posición y el alto
 * del bloque salen de minutos × px/hora; la zona interactiva de 44 px sigue siendo independiente de la geometría visible).
 *
 * «Compacta» NO tiene un alto fijo por hora: reparte el espacio realmente disponible entre las horas del eje (la jornada completa
 * entra sin desplazarse; ver `fitHourHeight`). «Media» (64 px) y «Amplia» (80 px) conservan su escala y se desplazan DENTRO de la
 * zona de agenda. La preferencia es de ese navegador (`localStorage`, nunca la base): un valor ausente, ilegible o inválido vuelve
 * a la densidad por defecto, definida en un solo lugar (`DEFAULT_CALENDAR_DENSITY`).
 */
export type CalendarDensityKey = "compact" | "medium" | "wide";

export interface CalendarDensity {
  readonly key: CalendarDensityKey;
  readonly label: string;
  /** Alto fijo por hora, o `null` cuando se calcula según el espacio disponible (Compacta). */
  readonly hourHeightPx: number | null;
}

export const CALENDAR_DENSITIES: readonly CalendarDensity[] = [
  { key: "compact", label: "Compacta", hourHeightPx: null },
  { key: "medium", label: "Media", hourHeightPx: 64 },
  { key: "wide", label: "Amplia", hourHeightPx: 80 },
];

export const DEFAULT_CALENDAR_DENSITY: CalendarDensityKey = "compact";
export const CALENDAR_DENSITY_STORAGE_KEY = "teacherflow.calendar.density.v1";

/** Valor guardado → densidad. Cualquier cosa que no sea exactamente una de las tres claves vuelve a la densidad por defecto. */
export function parseCalendarDensity(raw: unknown): CalendarDensityKey {
  return CALENDAR_DENSITIES.some((density) => density.key === raw) ? (raw as CalendarDensityKey) : DEFAULT_CALENDAR_DENSITY;
}

export function calendarDensityLabel(key: CalendarDensityKey): string {
  return (CALENDAR_DENSITIES.find((density) => density.key === key) ?? CALENDAR_DENSITIES[0]).label;
}

/** Alto fijo por hora de la densidad, o `null` si se ajusta al espacio disponible (Compacta). */
export function hourHeightFor(key: CalendarDensityKey): number | null {
  return (CALENDAR_DENSITIES.find((density) => density.key === key) ?? CALENDAR_DENSITIES[0]).hourHeightPx;
}

/** Piso de «Compacta»: por debajo de este alto por hora el texto de las tarjetas deja de ser legible y la zona de agenda se desplaza. */
export const COMPACT_MIN_HOUR_HEIGHT_PX = 24;
/** Sólo para el primer dibujo, antes de medir el espacio (servidor y primer render del navegador). */
export const COMPACT_INITIAL_HOUR_HEIGHT_PX = 40;

export interface HourFit {
  readonly hourHeightPx: number;
  /** `true` si ni siquiera el piso entra: la zona de agenda se desplaza por dentro. */
  readonly overflows: boolean;
}

/**
 * Alto por hora que hace entrar `hours` horas en el espacio disponible: (disponible − parte fija) / horas, redondeado hacia abajo a
 * cuartos de píxel para que nunca sobre contenido (sin barra de desplazamiento por redondeo). `fixedPx` es todo lo que ocupa la zona
 * y no es el eje (encabezado de los días, bordes, barra horizontal si existe); se MIDE, no se estima.
 */
export function fitHourHeight(input: { availablePx: number; fixedPx: number; hours: number }): HourFit {
  const { availablePx, fixedPx, hours } = input;
  const raw = Number.isFinite(availablePx) && Number.isFinite(fixedPx) && hours > 0 ? (availablePx - fixedPx) / hours : 0;
  const fitted = Math.floor(raw * 4) / 4;
  if (fitted < COMPACT_MIN_HOUR_HEIGHT_PX) return { hourHeightPx: COMPACT_MIN_HOUR_HEIGHT_PX, overflows: true };
  return { hourHeightPx: fitted, overflows: false };
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

export type DensityPickerKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Opción resaltada del selector al mover con el teclado: flechas con vuelta, Inicio y Fin. */
export function moveActiveDensity(index: number, key: DensityPickerKey, count: number = CALENDAR_DENSITIES.length): number {
  if (count <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return key === "ArrowDown" ? (index + 1) % count : (index - 1 + count) % count;
}
