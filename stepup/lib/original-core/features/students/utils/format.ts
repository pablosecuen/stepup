// Puerto VERBATIM del original (`src/features/students/utils/format.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { resolveDisplayableNextClassAt } from '../../calendar/utils/calendarNextClassAt.ts';

/**
 * Corrección P0 (a pedido de Joaquín — "próxima clase" pasada y
 * recurrencias futuras ausentes): antes esto formateaba cualquier fecha
 * recibida sin verificar si ya había pasado — una fecha vencida caía en la
 * rama genérica `"${dayLabel} ${time}"`, indistinguible visualmente de una
 * fecha futura real (así se veía "4 ago 6:00 p. m." como si fuera la
 * próxima clase). `resolveDisplayableNextClassAt` es el mismo cinturón de
 * seguridad que usa el resto de las pantallas — nunca muestra otra fecha
 * como reemplazo.
 */
/**
 * Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
 * TERMINE LA CLASE EN CURSO): `endIso` es opcional (dato viejo/ausente se
 * comporta igual que antes) — cuando se conoce, distingue "ya empezó pero
 * sigue en curso" (nunca se descarta, muestra "Clase en curso") de "ya
 * terminó de verdad".
 */
export function formatNextClassLabel(iso: string | null, endIso: string | null = null): string {
  const now = new Date();
  const displayable = resolveDisplayableNextClassAt(iso, now, endIso);
  if (!displayable) return 'Sin próxima clase programada';

  const date = new Date(displayable);
  if (endIso && date.getTime() <= now.getTime() && new Date(endIso).getTime() > now.getTime()) {
    return 'Clase en curso';
  }
  const isToday = date.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Hoy ${time}`;
  if (isTomorrow) return `Mañana ${time}`;

  const dayLabel = date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
  return `${dayLabel} ${time}`;
}

export function formatLastPaymentLabel(iso: string | null): string {
  if (!iso) return 'Sin pagos';

  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 30) return `Hace ${diffDays} días`;

  const months = Math.floor(diffDays / 30);
  return `Hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
