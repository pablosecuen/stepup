// Manejo cliente CENTRAL de fallas de red al invocar Server Actions.
//
// Hallazgo real (probado en build de producción, interceptando sólo
// requests con `Next-Action`): si el `fetch` de la acción rechaza a nivel
// de red, Next.js lanza una excepción en el cliente ANTES de llegar al
// `try/catch` del servidor. React 19 la propaga así:
//   - `useActionState` / `<form action>` / `startTransition(async)` →
//     la captura `app/error.tsx` (última defensa), pero desmonta el
//     formulario: se pierde todo lo escrito.
//   - `await` directo dentro de un handler → NADIE la captura (rechazo no
//     manejado, silencioso) y cualquier `setBusy(false)` posterior nunca
//     corre: el botón queda bloqueado.
// Por eso cada sitio que invoca una acción pasa por `guardNetwork` (o por
// `useGuardedActionState`): la falla de red se convierte en el mismo
// `{ error }` que ya sabe mostrar cada pantalla, nunca en una excepción.
//
// Este módulo es puro (sin React, sin alias `@/`) para poder probarse con
// `node --test`; sólo toca `document`/`FormData` cuando existen.

export const NETWORK_ERROR_MESSAGE =
  "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar: lo que escribiste sigue acá.";

// Firmas reales de un `fetch` que no llegó a obtener respuesta HTTP:
// Chromium "Failed to fetch", WebKit "Load failed", Firefox "NetworkError
// when attempting to fetch resource", Node/undici "fetch failed".
const NETWORK_FAILURE_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE_PATTERN.test(error.message);
}

/**
 * Estado de un formulario `useActionState` tras una falla de red: conserva
 * todo lo que ya tenía (p. ej. el panel de posible duplicado) salvo `values`
 * — ese eco viene de un rechazo VIEJO del servidor y reescribiría con datos
 * desactualizados lo que la profesora siguió escribiendo después.
 */
export function networkFailureState<S extends { error?: string }>(prev: S): S {
  return { ...prev, error: NETWORK_ERROR_MESSAGE, values: undefined };
}

// ---------------------------------------------------------------------------
// Conservación de valores escritos
// ---------------------------------------------------------------------------

export interface RestorableField {
  tagName: string;
  name: string;
  type: string;
  disabled: boolean;
  value: string;
  checked?: boolean;
  multiple?: boolean;
  options?: ArrayLike<{ value: string; selected: boolean }>;
}

export interface RestorableForm {
  elements: ArrayLike<unknown>;
}

const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);

/**
 * Vuelve a escribir en el formulario lo que había al momento del envío.
 * React 19 resetea los campos no controlados del `<form>` cuando la acción
 * termina — incluso si terminó con un `{ error }` devuelto — así que tras
 * una falla de red hay que reponer lo que la profesora ya había escrito.
 * Idempotente: repetirla no cambia nada. Los `hidden`/botones/archivos no se
 * tocan (los controla React o el servidor).
 */
export function restoreFormValues(form: RestorableForm, snapshot: Pick<FormData, "get" | "getAll">): void {
  for (const raw of Array.from(form.elements)) {
    const field = raw as RestorableField;
    if (!field || !field.name || field.disabled) continue;
    const tag = field.tagName?.toUpperCase();
    if (tag === "INPUT") {
      if (SKIPPED_INPUT_TYPES.has(field.type)) continue;
      if (field.type === "checkbox" || field.type === "radio") {
        field.checked = snapshot.getAll(field.name).some((v) => v === field.value);
      } else {
        const value = snapshot.get(field.name);
        if (typeof value === "string") field.value = value;
      }
    } else if (tag === "TEXTAREA") {
      const value = snapshot.get(field.name);
      if (typeof value === "string") field.value = value;
    } else if (tag === "SELECT") {
      if (field.multiple && field.options) {
        const chosen = new Set(snapshot.getAll(field.name).filter((v): v is string => typeof v === "string"));
        for (const option of Array.from(field.options)) option.selected = chosen.has(option.value);
      } else {
        const value = snapshot.get(field.name);
        if (typeof value === "string") field.value = value;
      }
    }
  }
}

interface SubmitClaim {
  form: HTMLFormElement;
  snapshot: FormData;
}

let freshSubmit: SubmitClaim | null = null;
let captureInstalled = false;

// Captura, en fase de captura y sólo por el resto de ESE mismo despacho de
// evento, el formulario que se acaba de enviar y una copia de sus valores.
// La acción que React invoca a continuación (misma tarea) lo "reclama"
// sincrónicamente; cualquier llamada posterior (un botón cualquiera, mucho
// después) no hereda nunca un envío viejo.
function installSubmitCapture(): void {
  if (captureInstalled || typeof document === "undefined") return;
  captureInstalled = true;
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      try {
        freshSubmit = { form, snapshot: new FormData(form, (event as SubmitEvent).submitter) };
      } catch {
        freshSubmit = null;
      }
      setTimeout(() => {
        freshSubmit = null;
      }, 0);
    },
    true
  );
}

// Tiene que estar instalado ANTES del primer envío (React despacha la acción
// en ese mismo evento): se instala al cargar el módulo en el navegador.
installSubmitCapture();

function claimFreshSubmit(): SubmitClaim | null {
  const claim = freshSubmit;
  freshSubmit = null;
  return claim;
}

function scheduleRestore(claim: SubmitClaim | null): void {
  if (!claim) return;
  const { form, snapshot } = claim;
  const run = () => {
    if (form.isConnected) restoreFormValues(form, snapshot);
  };
  // 1) Formularios cuyo `action` ya terminó (y ya se reseteó) antes de que
  //    fallara la red — p. ej. `action={submit}` con `startTransition` adentro.
  queueMicrotask(run);
  setTimeout(run, 0);
  // 2) `useActionState`: React resetea el formulario DESPUÉS de devolver el
  //    estado. El evento `reset` se dispara antes de que los campos vuelvan a
  //    su valor inicial, así que se repone en el turno siguiente.
  const onReset = () => setTimeout(run, 0);
  form.addEventListener("reset", onReset, { once: true });
  setTimeout(() => form.removeEventListener("reset", onReset), 3000);
}

/**
 * Ejecuta una llamada a un Server Action. Si falla por red devuelve
 * `{ error }` (el mismo contrato de error que ya devuelve el servidor) y
 * repone lo escrito en el formulario; cualquier otro error se relanza tal
 * cual — la última defensa (`app/error.tsx`) sigue cubriéndolo.
 */
export async function guardNetwork<R extends { error?: string }>(run: () => Promise<R>): Promise<R> {
  const claim = claimFreshSubmit();
  try {
    return await run();
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    scheduleRestore(claim);
    return { error: NETWORK_ERROR_MESSAGE } as R;
  }
}

/** Variante para `useActionState`: conserva el resto del estado previo. */
export async function guardFormAction<S extends { error?: string }, P>(
  action: (prev: S, payload: P) => Promise<S>,
  prev: S,
  payload: P
): Promise<S> {
  const claim = claimFreshSubmit();
  try {
    return await action(prev, payload);
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    scheduleRestore(claim);
    return networkFailureState(prev);
  }
}
