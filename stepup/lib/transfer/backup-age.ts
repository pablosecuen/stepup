/**
 * Antigüedad del último respaldo de la nube del origen al momento de copiarlo. La copia del origen es útil para el cotejo final sólo si es
 * posterior a la última carga hecha en la app anterior: este ayudante lo dice en lenguaje simple (sin datos personales: sólo fechas y minutos).
 */

export const FRESH_BACKUP_MAX_MINUTES = 15;

export type BackupAge = {
  /** Minutos enteros desde la creación del respaldo (nunca negativo). */
  minutes: number;
  fresh: boolean;
  /** dd/mm/aaaa hh:mm en hora local. */
  createdAtLabel: string;
  message: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocalDateTime(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function describeBackupAge(createdAt: string | null | undefined, now: Date, maxMinutes = FRESH_BACKUP_MAX_MINUTES): BackupAge | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000));
  const fresh = minutes <= maxMinutes;
  const createdAtLabel = formatLocalDateTime(created);
  const elapsed = minutes < 60 ? `${minutes} min` : minutes < 24 * 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / (24 * 60))} día(s)`;
  const message = fresh
    ? `El último respaldo de la nube es del ${createdAtLabel} (hace ${elapsed}).`
    : `AVISO: el último respaldo de la nube es del ${createdAtLabel} (hace ${elapsed}). Si cargaste algo después, NO está en esta copia: dejá de cargar, abrí TeacherFlow anterior, esperá a ver «Protección automática activa» con la hora actual y repetí la copia.`;
  return { minutes, fresh, createdAtLabel, message };
}
