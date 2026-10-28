// Puerto VERBATIM del original (`src/features/payments/utils/registerPaymentSubmission.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG: pago registrado queda
 * abierto después de minimizar la aplicación): orquestación EXTRAÍDA de
 * `RegisterPaymentSheet.tsx` — antes vivía sólo dentro del componente, sin
 * forma de probarla con un servicio controlable (el proyecto no tiene
 * infraestructura para renderizar componentes React en sus pruebas). Esta
 * función es pura respecto de React: recibe refs/setters como parámetros
 * simples (`{ current: T }` — el mismo shape que devuelve `useRef`, así que
 * el componente se la pasa literalmente tal cual) y el propio servicio de
 * registro como dependencia inyectable — "el servicio controlable" que
 * piden las pruebas.
 *
 * PRINCIPIO: registro y cierre son una única transición de éxito.
 * `onRegistered(amount)` se llama INMEDIATAMENTE después de que el registro
 * real termina, antes de tocar cualquier estado visual propio — nunca hay
 * un `Alert` ni ningún otro paso intermedio que minimizar la app pueda
 * dejar trabado. `onRegistered` es responsabilidad del padre (cerrar el
 * panel, mostrar una confirmación no bloqueante); nunca se omite por estar
 * desmontado, porque afecta el estado del PADRE, no el de este formulario.
 *
 * Los `setState` LOCALES (`setIsSubmitting`/`setErrorMessage`) si se
 * protegen con `isMountedRef` — evita la advertencia de React "no se puede
 * actualizar el estado de un componente desmontado" si la profesora
 * cambió de pestaña mientras el pago todavía estaba en camino.
 *
 * `isSubmittingRef` bloquea SÍNCRONAMENTE un segundo toque en "Confirmar
 * pago" — corre antes que cualquier otra cosa, así un doble toque muy
 * rápido nunca llega a disparar un segundo registro real (nunca duplica
 * pagos ni asignaciones).
 */
import type { RegisterPaymentInput } from '../services/registerPaymentService.ts';
import type { RegisterPaymentPlanResult } from './registerPaymentPlan.ts';

export interface SubmitRegisterPaymentInput {
  paymentInput: RegisterPaymentInput;
  /** El servicio real (`registerPaymentForStudent`) en producción; una función controlable en pruebas. */
  registerPayment: (input: RegisterPaymentInput) => Promise<RegisterPaymentPlanResult>;
  /** Se llama UNA vez, con el importe confirmado, apenas el registro termina con éxito. */
  onRegistered: (amount: number) => void;
  isSubmittingRef: { current: boolean };
  isMountedRef: { current: boolean };
  setIsSubmitting: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
}

const DEFAULT_ERROR_MESSAGE = 'No se pudo registrar el pago. No se guardó ningún cambio.';

export async function submitRegisterPayment(input: SubmitRegisterPaymentInput): Promise<void> {
  const {
    paymentInput,
    registerPayment,
    onRegistered,
    isSubmittingRef,
    isMountedRef,
    setIsSubmitting,
    setErrorMessage,
  } = input;

  if (isSubmittingRef.current) return;
  isSubmittingRef.current = true;
  setIsSubmitting(true);
  setErrorMessage(null);

  try {
    await registerPayment(paymentInput);
    onRegistered(paymentInput.amount);
  } catch (error) {
    if (isMountedRef.current) {
      setErrorMessage(error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE);
    }
  } finally {
    isSubmittingRef.current = false;
    if (isMountedRef.current) setIsSubmitting(false);
  }
}
