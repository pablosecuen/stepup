// Puerto VERBATIM del original (`src/features/student-profile/utils/format.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/** `undefined`/vacío → `null` (edad no cargada), nunca un error ni un 0 falso. */
export function calculateAge(birthDateIso: string | undefined | null): number | null {
  if (!birthDateIso) return null;
  const birth = new Date(birthDateIso);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function formatCurrencyARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatRelativeDateTime(iso: string | null): string {
  if (!iso) return 'Sin datos';

  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Hoy ${time}`;
  if (isTomorrow) return `Mañana ${time}`;
  if (isYesterday) return `Ayer ${time}`;

  const dayLabel = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  return `${dayLabel} ${time}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Sin datos';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatHours(totalHours: number): string {
  return `${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)} h`;
}
