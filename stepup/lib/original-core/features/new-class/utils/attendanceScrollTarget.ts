// Puerto VERBATIM del original (`src/features/new-class/utils/attendanceScrollTarget.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-11 (a pedido de Joaquín — corrección urgente de
 * registro de clases, error real `ref.measureLayout must be called with a
 * ref to a native component`): función PURA, extraída a un archivo `.ts`
 * (nunca `.tsx`) para poder probarla sin montar componentes React ni
 * requerir configuración de JSX en las suites de pruebas (mismo patrón que
 * el resto del proyecto: dominio puro separado de la UI).
 *
 * Reemplaza por completo a `node.measureLayout(scroller.getInnerViewNode
 * ? scroller.getInnerViewNode() : scroller, ...)` — bajo la New
 * Architecture, `getInnerViewNode` ya no existe en un `ScrollView` real, así
 * que ese ternary terminaba pasándole el WRAPPER de JS del ScrollView (no
 * un nodo nativo) a `measureLayout`, y ahí el error real. Acá no se "mide"
 * nada: `baseY` (posición absoluta del contenedor, reportada por su propio
 * `onLayout`) y `rowY` (posición de la fila relativa a ESE contenedor,
 * reportada por `AttendanceRow.onLayout`) ya vienen calculados por React
 * Native — sólo se suman. `-24` deja un margen arriba de la fila; nunca
 * negativo (un ScrollView no acepta `scrollTo({ y: negativo })` de forma
 * útil).
 */
export function computeAttendanceScrollTargetY(baseY: number, rowY: number): number {
  return Math.max(baseY + rowY - 24, 0);
}
