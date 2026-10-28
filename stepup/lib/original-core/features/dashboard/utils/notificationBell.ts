// Puerto VERBATIM del original (`src/features/dashboard/utils/notificationBell.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "LA CAMPANA NO APARECE EN
 * HOME"): lógica pura de la insignia de la campana de notificaciones —
 * separada del componente visual para poder probarla sin compilar JSX,
 * igual que el resto de los motores de la app.
 */

/**
 * Texto de la insignia roja: `null` cuando no hay que mostrarla (contador
 * cero o negativo), el número exacto entre 1 y 99, y "99+" a partir de 100
 * — nunca un número de 3+ dígitos que no entre en el círculo.
 */
export function formatNotificationBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count > 99) return '99+';
  return String(count);
}

/**
 * Etiqueta accesible de la campana. Siempre menciona el estado real del
 * contador, nunca sólo "Notificaciones" a secas — para que un lector de
 * pantalla informe si hay algo pendiente sin depender de ver la insignia.
 */
export function notificationBellAccessibilityLabel(count: number): string {
  if (count <= 0) return 'Notificaciones, sin recordatorios pendientes';
  if (count === 1) return 'Notificaciones, 1 recordatorio pendiente';
  return `Notificaciones, ${count} recordatorios pendientes`;
}
