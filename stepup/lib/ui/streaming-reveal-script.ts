/**
 * La disponibilidad del contenido NUNCA depende de `requestAnimationFrame` (29/10/2026).
 *
 * Causa del bloqueo «Cargando alumnos…» con el panel o la pestaña en segundo plano: en una carga de página completa el servidor envía primero
 * el esqueleto (`loading.tsx`) y después el contenido real junto con una instrucción en línea (`$RC`) que lo intercambia. Esa instrucción de
 * React (react-dom/server, runtime de «completar límite») decide CÓMO reemplazar según `$RT`, una marca de tiempo que él mismo fija dentro de
 * un `requestAnimationFrame`:
 *
 *     "number" !== typeof $RT ? requestAnimationFrame($RV…) : setTimeout($RV…, 2300>a&&2E3<a ? 2300-a : $RT+300-a)
 *
 * Con la pestaña oculta, minimizada o tapada el navegador PAUSA `requestAnimationFrame`: `$RT` nunca llega a ser un número, el reemplazo
 * espera a un fotograma que no ocurre y el esqueleto queda para siempre aunque los datos hayan llegado.
 *
 * Remedio: definir `$RT` como número desde el inicio del documento (un valor muy anterior a cualquier instante real). Así el intercambio usa
 * `setTimeout` —que corre también con la pestaña oculta— y, como `$RT + 300 − ahora` es negativo, no agrega demora alguna (React sólo
 * espacia las revelaciones que caen entre los 2,0 y los 2,3 s de la carga, hasta 300 ms, y esa regla no se toca). La navegación dentro de la
 * aplicación no pasa por esta instrucción (la hace React en el cliente), y la hidratación posterior sigue su curso normal al volver a la pestaña.
 * Se imprime en el `<head>` del documento raíz, antes de cualquier instrucción de React.
 */
export const STREAMING_REVEAL_SCRIPT = 'if(typeof window.$RT!=="number")window.$RT=-1e9;';
