// Puerto VERBATIM del original (`src/features/dashboard/utils/activeClassTiming.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-17 (a pedido de Joaquín): funciones puras del contador
 * de "clase en curso" — separadas de cualquier componente para poder
 * probarlas sin infraestructura de render, mismo patrón que el resto del
 * proyecto (`calendarDailyDemand.ts`, `buildHomeFinancialSummary.ts`, etc.).
 */
export function computeElapsedSeconds(startedAt: string, now: Date): number {
  const startedMs = new Date(startedAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - startedMs) / 1000));
}

/** Negativo = todavía faltan minutos; 0 = justo termina; positivo = clase en tiempo extra. */
export function computeOvertimeSeconds(
  startedAt: string,
  scheduledDurationMinutes: number,
  now: Date
): number {
  return computeElapsedSeconds(startedAt, now) - scheduledDurationMinutes * 60;
}

/** 0 a 1, nunca supera 1 aunque la clase esté en tiempo extra (la barra se llena y se queda llena). */
export function computeProgressFraction(
  startedAt: string,
  scheduledDurationMinutes: number,
  now: Date
): number {
  if (scheduledDurationMinutes <= 0) return 1;
  const elapsed = computeElapsedSeconds(startedAt, now);
  const total = scheduledDurationMinutes * 60;
  return Math.min(1, elapsed / total);
}

/** mm:ss para el tiempo restante, o "+mm:ss" para tiempo extra. */
export function formatCountdown(overtimeSeconds: number): string {
  const isOvertime = overtimeSeconds > 0;
  const totalSeconds = Math.abs(overtimeSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return isOvertime ? `+${formatted}` : formatted;
}

/** Minutos reales transcurridos desde que arrancó, redondeados — para prefillear "Duración real" al finalizar. */
export function computeElapsedMinutesRounded(startedAt: string, now: Date): number {
  return Math.max(1, Math.round(computeElapsedSeconds(startedAt, now) / 60));
}

/** Texto para la notificación de Android — misma lógica de tiempo restante/extra que la tarjeta de Inicio. */
export function buildClassSessionNotificationBody(
  startedAt: string,
  scheduledDurationMinutes: number,
  now: Date
): string {
  const overtimeSeconds = computeOvertimeSeconds(startedAt, scheduledDurationMinutes, now);
  const countdown = formatCountdown(overtimeSeconds);
  return overtimeSeconds > 0 ? `Tiempo extra: ${countdown}` : `Quedan ${countdown} de ${scheduledDurationMinutes} min`;
}
