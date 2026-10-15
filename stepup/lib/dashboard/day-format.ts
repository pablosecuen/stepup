/** Textos relativos de Inicio («Empieza en 2 h 30 min», «Termina a las 13:00»), a partir de minutos ya calculados con el reloj de la carga. */

/** «45 min», «2 h», «2 h 30 min»: sin ceros sobrantes. Valores no finitos o negativos → «menos de 1 min». */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "menos de 1 min";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatStartsIn(startMs: number, nowMs: number): string {
  return `Empieza en ${formatDuration((startMs - nowMs) / 60_000)}`;
}
