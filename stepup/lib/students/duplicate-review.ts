/**
 * Aviso de posible duplicado de «Nuevo alumno»: el servidor lo devuelve dentro del estado de la acción. «Volver y editar los
 * datos» sólo lo oculta en pantalla (no envía nada, no crea nada, no toca la clave de operación ni el formulario): se recuerda
 * QUÉ estado se descartó, así un envío nuevo (que devuelve otro estado) vuelve a mostrar el aviso si corresponde.
 */
export function isDuplicatePanelVisible(state: { duplicate?: unknown }, dismissedState: unknown): boolean {
  return Boolean(state.duplicate) && state !== dismissedState;
}
