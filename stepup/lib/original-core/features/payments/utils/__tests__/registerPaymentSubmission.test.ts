// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/registerPaymentSubmission.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG: pago registrado queda
 * abierto después de minimizar la aplicación): pruebas de
 * `submitRegisterPayment`, la orquestación extraída de
 * `RegisterPaymentSheet.tsx` para poder probarla con un "servicio
 * controlable" — una función `registerPayment` cuya promesa resolvemos o
 * rechazamos manualmente desde la prueba, simulando exactamente lo que
 * pasa cuando la app se minimiza mientras el registro real todavía está en
 * camino (el motor de JS sigue corriendo esa misma promesa; sólo tarda más
 * en resolverse). Nunca usa AsyncStorage/Supabase reales — el "servicio"
 * es enteramente una función fake en memoria.
 */
import type { RegisterPaymentInput } from '../../services/registerPaymentService.ts';
import type { RegisterPaymentPlanResult } from '../registerPaymentPlan.ts';
import { submitRegisterPayment } from '../registerPaymentSubmission.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

function createControllablePromise<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeResult(): RegisterPaymentPlanResult {
  return {
    payment: {
      id: 'payment_qa_1',
      studentId: 'qa_pago_bg_1',
      amount: 20000,
      currency: 'ARS',
      method: 'efectivo',
      paidAt: '2026-08-10',
      recordedAt: '2026-08-10T12:00:00.000Z',
      voidedAt: null,
      voidReason: null,
      replacesPaymentId: null,
    },
    allocations: [],
  };
}

function basePaymentInput(overrides: Partial<RegisterPaymentInput> = {}): RegisterPaymentInput {
  return {
    studentId: 'qa_pago_bg_1',
    amount: 20000,
    method: 'efectivo',
    paidAt: '2026-08-10',
    notes: undefined,
    ...overrides,
  };
}

interface Harness {
  isSubmittingRef: { current: boolean };
  isMountedRef: { current: boolean };
  isSubmittingCalls: boolean[];
  errorMessageCalls: Array<string | null>;
  registeredAmounts: number[];
  registerPaymentCalls: RegisterPaymentInput[];
}

function makeHarness(): Harness {
  return {
    isSubmittingRef: { current: false },
    isMountedRef: { current: true },
    isSubmittingCalls: [],
    errorMessageCalls: [],
    registeredAmounts: [],
    registerPaymentCalls: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Pago exitoso sin minimizar: guarda una vez y cierra.
// ---------------------------------------------------------------------------
asyncTest('pago exitoso sin minimizar: registra una única vez y llama a onRegistered con el importe exacto', async () => {
  const h = makeHarness();
  await submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async (input) => {
      h.registerPaymentCalls.push(input);
      return fakeResult();
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  assertEqual(h.registerPaymentCalls.length, 1, 'el servicio real se llama exactamente una vez');
  assertEqual(h.registeredAmounts.length, 1, 'onRegistered se llama exactamente una vez');
  assertEqual(h.registeredAmounts[0], 20000, 'con el importe exacto registrado');
  assertEqual(h.isSubmittingCalls.join(','), 'true,false', 'isSubmitting pasa a true y vuelve a false');
  assert(h.errorMessageCalls.includes(null), 'el error se limpia al empezar');
  assertEqual(h.isSubmittingRef.current, false, 'el guard queda liberado al terminar');
});

// ---------------------------------------------------------------------------
// 2. Se minimiza mientras el pago está pendiente y luego finaliza: al volver
//    queda cerrado (onRegistered se llama apenas la promesa resuelve, sin
//    importar cuánto tardó en el medio).
// ---------------------------------------------------------------------------
asyncTest('minimizar mientras el pago está pendiente: al resolverse (aunque tarde) onRegistered cierra el panel una sola vez', async () => {
  const h = makeHarness();
  const controllable = createControllablePromise<RegisterPaymentPlanResult>();

  const submission = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async (input) => {
      h.registerPaymentCalls.push(input);
      return controllable.promise;
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  // "La app está en segundo plano": la promesa todavía no resolvió.
  assertEqual(h.registeredAmounts.length, 0, 'todavía no se cerró nada — el registro real sigue en camino');
  assertEqual(h.isSubmittingRef.current, true, 'el guard sigue tomado mientras está pendiente');

  // "Vuelve a primer plano" y el registro real termina.
  controllable.resolve(fakeResult());
  await submission;

  assertEqual(h.registeredAmounts.length, 1, 'apenas resuelve, se cierra — una única vez');
  assertEqual(h.registeredAmounts[0], 20000, 'con el importe correcto');
  assertEqual(h.isSubmittingRef.current, false, 'el guard queda liberado');
});

// ---------------------------------------------------------------------------
// 3. Se minimiza después del éxito: no reaparece el panel ni una alerta.
// ---------------------------------------------------------------------------
asyncTest('después del éxito, volver a invocar submitRegisterPayment con el guard ya liberado no reutiliza el registro anterior', async () => {
  const h = makeHarness();
  await submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async (input) => {
      h.registerPaymentCalls.push(input);
      return fakeResult();
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });
  assertEqual(h.registeredAmounts.length, 1, 'un único cierre tras el éxito real');

  // Nada en este módulo reabre el panel ni dispara un segundo registro por
  // su cuenta — el panel sigue cerrado del lado del padre (isRegisterPaymentSheetOpen
  // en false) a menos que la profesora vuelva a tocar "Registrar pago"
  // explícitamente, algo que está fuera de esta función.
  assertEqual(h.registeredAmounts.length, 1, 'sin una nueva invocación explícita, no hay un segundo cierre ni un segundo registro');
});

// ---------------------------------------------------------------------------
// 4. El pago falla mientras está en segundo plano: al volver muestra el
//    error y conserva los campos (los campos los conserva el LLAMADOR —
//    acá se confirma que la función nunca los toca ni cierra el panel).
// ---------------------------------------------------------------------------
asyncTest('el pago falla (incluso resuelto tarde, tras volver de segundo plano): muestra el error, nunca cierra el panel', async () => {
  const h = makeHarness();
  const controllable = createControllablePromise<RegisterPaymentPlanResult>();

  const submission = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async () => controllable.promise,
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  controllable.reject(new Error('Sin conexión — no se pudo guardar el pago.'));
  await submission;

  assertEqual(h.registeredAmounts.length, 0, 'onRegistered nunca se llama si falló — el panel nunca se cierra solo');
  assert(h.errorMessageCalls.includes('Sin conexión — no se pudo guardar el pago.'), 'el mensaje de error real llega al formulario');
  assertEqual(h.isSubmittingCalls[h.isSubmittingCalls.length - 1], false, 'vuelve a habilitar el botón para reintentar');
  assertEqual(h.isSubmittingRef.current, false, 'el guard se libera — permite un reintento real');
});

asyncTest('mensaje de error genérico cuando el servicio rechaza con algo que no es un Error real', async () => {
  const h = makeHarness();
  await submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async () => {
      throw 'fallo desconocido'; // eslint-disable-line no-throw-literal
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });
  assert(
    h.errorMessageCalls.includes('No se pudo registrar el pago. No se guardó ningún cambio.'),
    'nunca deja el mensaje de error vacío o "undefined"'
  );
});

// ---------------------------------------------------------------------------
// 5. Doble toque antes de minimizar: un único pago.
// ---------------------------------------------------------------------------
asyncTest('doble toque casi simultáneo en "Confirmar pago": el guard síncrono bloquea el segundo antes de llamar al servicio — un único pago', async () => {
  const h = makeHarness();
  const controllable = createControllablePromise<RegisterPaymentPlanResult>();

  const firstCall = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async (input) => {
      h.registerPaymentCalls.push(input);
      return controllable.promise;
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });
  // Segundo toque SÍNCRONO, antes de que la primera invocación llegue a
  // resolver nada — exactamente la condición de carrera real de un doble
  // toque físico.
  const secondCall = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async (input) => {
      h.registerPaymentCalls.push(input);
      return controllable.promise;
    },
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  controllable.resolve(fakeResult());
  await Promise.all([firstCall, secondCall]);

  assertEqual(h.registerPaymentCalls.length, 1, 'el servicio real se llama UNA sola vez — nunca dos pagos');
  assertEqual(h.registeredAmounts.length, 1, 'onRegistered también se llama una sola vez');
});

// ---------------------------------------------------------------------------
// Protección contra actualizaciones tardías tras desmontarse.
// ---------------------------------------------------------------------------
asyncTest('componente desmontado antes de que el registro resuelva: nunca toca setIsSubmitting/setErrorMessage locales, pero sí notifica onRegistered', async () => {
  const h = makeHarness();
  const controllable = createControllablePromise<RegisterPaymentPlanResult>();

  const submission = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async () => controllable.promise,
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  // La profesora cambia de pestaña: el componente se desmonta mientras el
  // registro real sigue en camino.
  h.isMountedRef.current = false;
  const callsBeforeResolve = h.isSubmittingCalls.length;

  controllable.resolve(fakeResult());
  await submission;

  assertEqual(
    h.isSubmittingCalls.length,
    callsBeforeResolve,
    'nunca se vuelve a llamar setIsSubmitting después de desmontarse (evita el warning de React)'
  );
  assertEqual(h.registeredAmounts.length, 1, 'onRegistered SÍ se llama — es responsabilidad del padre, no de este formulario ya desmontado');
});

asyncTest('componente desmontado antes de que el registro falle: nunca toca setErrorMessage local', async () => {
  const h = makeHarness();
  const controllable = createControllablePromise<RegisterPaymentPlanResult>();

  const submission = submitRegisterPayment({
    paymentInput: basePaymentInput(),
    registerPayment: async () => controllable.promise,
    onRegistered: (amount) => h.registeredAmounts.push(amount),
    isSubmittingRef: h.isSubmittingRef,
    isMountedRef: h.isMountedRef,
    setIsSubmitting: (value) => h.isSubmittingCalls.push(value),
    setErrorMessage: (value) => h.errorMessageCalls.push(value),
  });

  h.isMountedRef.current = false;
  const errorCallsBefore = h.errorMessageCalls.length;

  controllable.reject(new Error('falló'));
  await submission;

  assertEqual(h.errorMessageCalls.length, errorCallsBefore, 'nunca se llama setErrorMessage después de desmontarse');
  assertEqual(h.registeredAmounts.length, 0, 'un fallo nunca llama a onRegistered, esté montado o no');
});
