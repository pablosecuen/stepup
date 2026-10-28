// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/activeFieldVisibility.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-13 (a pedido de Joaquín — PROBLEMA P0: "el teclado
 * sigue tapando el texto en el registro de clases", segunda prueba física
 * real): pruebas de LÓGICA real (no sólo búsquedas de texto) del
 * controlador `createActiveFieldVisibilityController` — secuencias
 * completas simuladas con dependencias inyectadas (`scrollTo` falso),
 * exactamente como pide la corrección: "no hagas solamente pruebas que
 * busquen palabras en el código".
 */
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { computeFieldVisibilityScrollTargetY, createActiveFieldVisibilityController, type FieldKey } from '../activeFieldVisibility.ts';

function makeRecorder() {
  const calls: number[] = [];
  return {
    calls,
    scrollTo: (y: number) => {
      calls.push(y);
    },
  };
}

const FIELD_A: FieldKey = { name: 'campo-A' };
const FIELD_B: FieldKey = { name: 'campo-B' };

// ===========================================================================
// Geometría pura
// ===========================================================================

test('geometría 1) Con margen sobrado, no desplaza (conserva el offset actual)', () => {
  const target = computeFieldVisibilityScrollTargetY({
    currentScrollOffsetY: 50,
    fieldPageY: 100,
    fieldHeight: 20,
    visibleBottomY: 600,
    margin: 40,
  });
  assertEqual(target, 50, 'el campo ya está muy por encima del límite inferior — no hace falta mover nada');
});

test('geometría 2) Campo pegado al límite inferior real: desplaza exactamente lo necesario para dejar el margen pedido', () => {
  const target = computeFieldVisibilityScrollTargetY({
    currentScrollOffsetY: 400,
    fieldPageY: 600,
    fieldHeight: 60,
    visibleBottomY: 450,
    margin: 40,
  });
  // extremo inferior del campo = 660; objetivo = 450 - 40 = 410; exceso = 250.
  assertEqual(target, 650, 'baja lo necesario (400 + 250) para dejar el margen real pedido');
});

test('geometría 3) Nunca produce una coordenada negativa', () => {
  const target = computeFieldVisibilityScrollTargetY({
    currentScrollOffsetY: 0,
    fieldPageY: 5,
    fieldHeight: 10,
    visibleBottomY: 20,
    margin: 40,
  });
  assert(target >= 0, 'nunca negativo, incluso con muy poco margen disponible');
});

test('geometría 4) iPhone chico (visibleBottomY bajo) exige más desplazamiento que un iPhone grande, mismo campo', () => {
  const small = computeFieldVisibilityScrollTargetY({
    currentScrollOffsetY: 0,
    fieldPageY: 500,
    fieldHeight: 40,
    visibleBottomY: 480, // pantalla chica: el teclado deja poco espacio
    margin: 40,
  });
  const large = computeFieldVisibilityScrollTargetY({
    currentScrollOffsetY: 0,
    fieldPageY: 500,
    fieldHeight: 40,
    visibleBottomY: 700, // pantalla grande: el teclado deja mucho más espacio
    margin: 40,
  });
  assert(small > large, 'pantalla chica (17. iPhone pequeño) exige más scroll que pantalla grande (18. iPhone grande) para el mismo campo');
  assertEqual(large, 0, 'en la pantalla grande el campo ya entra cómodo, sin desplazar');
});

// ===========================================================================
// Controlador — secuencias reales
// ===========================================================================

test('1) Focus antes de keyboardDidShow: no desplaza todavía (el teclado real todavía no se conoce)', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  const gen = controller.focusField(FIELD_A);
  const result = controller.resolveFieldMeasurement(gen, { y: 700, height: 40 });
  assertEqual(result, null, 'sin teclado conocido, la medición se resuelve sin efecto');
  assertEqual(rec.calls.length, 0, 'no se llamó a scrollTo');
});

test('2) keyboardDidShow obliga a recalcular: la MISMA medición que antes no hacía nada, ahora sí desplaza', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450); // el pie ya está posicionado (límite inferior real)
  const genAfterKeyboard = controller.keyboardShown(300);
  assert(genAfterKeyboard !== null, 'keyboardShown pide una medición nueva porque hay un campo activo');
  const result = controller.resolveFieldMeasurement(genAfterKeyboard as number, { y: 500, height: 60 });
  assert(result !== null, 'con teclado conocido y pie medido, la corrección se aplica');
  assertEqual(rec.calls.length, 1, 'un único scrollTo real');
});

test('3) Segundo toque sobre un campo ya enfocado: pressInField pide una medición nueva aunque el campo activo no cambie', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  const gen1 = controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  controller.keyboardShown(300);
  controller.resolveFieldMeasurement(gen1, { y: 500, height: 40 }); // gen1 ya obsoleta tras keyboardShown

  const gen2 = controller.pressInField(FIELD_A);
  assert(gen2 !== gen1, 'pressInField sobre el mismo campo genera una generación nueva, nunca reutiliza la vieja');
  assertEqual(controller.getActiveField(), FIELD_A, 'el campo activo sigue siendo el mismo');
  const result = controller.resolveFieldMeasurement(gen2, { y: 500, height: 40 });
  assert(result !== null, 'la nueva medición SÍ corrige la posición — volver a tocar el campo funciona');
});

test('4) Campo multilínea que crece: contentSizeChanged sólo actúa sobre el campo activo y desplaza más si el campo ahora es más alto', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  const genShow = controller.keyboardShown(300);
  controller.resolveFieldMeasurement(genShow as number, { y: 300, height: 40 });
  const before = controller.getLastScrollTarget();

  const genGrow = controller.contentSizeChanged();
  assert(genGrow !== null, 'hay un campo activo — contentSizeChanged pide medición');
  controller.resolveFieldMeasurement(genGrow as number, { y: 300, height: 140 });
  const after = controller.getLastScrollTarget();
  assert((after ?? 0) > (before ?? 0), 'un campo más alto exige más scroll que antes de crecer');
});

test('5) Cambio de orientación/layout: windowSizeChanged re-chequea el campo activo', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  controller.keyboardShown(300);

  const gen = controller.windowSizeChanged();
  assert(gen !== null, 'con campo activo, un cambio de layout pide una medición nueva');
});

test('6) Cambio al siguiente alumno de un grupo: clearActiveField + focusField(B) — la medición vieja de A nunca llega a aplicarse', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  const genA = controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  controller.keyboardShown(300);

  controller.clearActiveField();
  const genB = controller.focusField(FIELD_B);

  const staleResult = controller.resolveFieldMeasurement(genA, { y: 100, height: 20 });
  assertEqual(staleResult, null, 'la medición del alumno A, resuelta tarde, se ignora por completo');
  assertEqual(rec.calls.length, 0, 'todavía no se desplazó nada por A');

  const resultB = controller.resolveFieldMeasurement(genB, { y: 500, height: 40 });
  assert(resultB !== null, 'la medición del alumno B (activo real) sí se aplica');
  assertEqual(rec.calls.length, 1, 'un único scrollTo, y es el de B');
});

test('7) Campo cerca del final del formulario: con visibleBottomY chico y poco margen restante, igual corrige sin quedar clavado', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(480); // pie muy arriba — poco espacio real
  const gen = controller.keyboardShown(350);
  const result = controller.resolveFieldMeasurement(gen as number, { y: 650, height: 60 });
  assert(result !== null, 'corrige igual, sin importar cuán cerca del final esté el campo');
  assert((result?.scrolledTo ?? 0) > 0, 'el destino calculado es un desplazamiento real hacia adelante');
});

test('8) Footer visible: footerLayoutChanged establece el límite inferior real usado por la geometría', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.keyboardShown(300);
  // Sin footer medido todavía: keyboardHeight > 0 pero visibleBottomY sigue null.
  const genNoFooter = controller.pressInField(FIELD_A);
  const resultNoFooter = controller.resolveFieldMeasurement(genNoFooter, { y: 500, height: 40 });
  assertEqual(resultNoFooter, null, 'sin el límite inferior real medido, nunca se inventa un destino');

  const genFooter = controller.footerLayoutChanged(450);
  assert(genFooter !== null, 'footerLayoutChanged también pide una medición nueva');
  const resultFooter = controller.resolveFieldMeasurement(genFooter as number, { y: 500, height: 40 });
  assert(resultFooter !== null, 'con el footer ya medido, la corrección se aplica');
});

test('9) Footer cambia de tamaño (p. ej. "Guardar progreso" → "Finalizar registro"): vuelve a chequear el campo activo con el nuevo límite', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.keyboardShown(300);
  const gen1 = controller.footerLayoutChanged(450);
  controller.resolveFieldMeasurement(gen1 as number, { y: 500, height: 40 });
  const firstTarget = controller.getLastScrollTarget();

  const gen2 = controller.footerLayoutChanged(430); // el pie creció (dos líneas de texto), sube su techo
  assert(gen2 !== null, 'el footer cambió de posición — se re-chequea el campo activo');
  controller.resolveFieldMeasurement(gen2 as number, { y: 500, height: 40 });
  const secondTarget = controller.getLastScrollTarget();
  assert((secondTarget ?? 0) >= (firstTarget ?? 0), 'un pie más alto (límite inferior más arriba) nunca exige MENOS margen');
});

test('10) Cerrar teclado arrastrando: keyboardHidden cancela cualquier medición en curso sin inventar scroll', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  const gen = controller.keyboardShown(300);
  controller.keyboardHidden();
  const result = controller.resolveFieldMeasurement(gen as number, { y: 500, height: 40 });
  assertEqual(result, null, 'la medición pedida antes de cerrar el teclado se descarta al cerrarse');
  assertEqual(controller.getKeyboardHeight(), 0, 'el alto de teclado conocido vuelve a 0');
});

test('12) Dos eventos de teclado seguidos (show + frame changed) no producen dos scrollTo — sólo la última generación se aplica', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  const genShow = controller.keyboardShown(300);
  const genFrame = controller.keyboardFrameChanged(310); // llega casi enseguida (barra predictiva)
  assert(genFrame !== genShow, 'cada evento pide su propia generación');

  // La medición del PRIMER evento (show) resuelve tarde — ya es obsoleta.
  const staleResult = controller.resolveFieldMeasurement(genShow as number, { y: 500, height: 40 });
  assertEqual(staleResult, null, 'la medición del evento show, resuelta después de frameChanged, se ignora');

  const result = controller.resolveFieldMeasurement(genFrame as number, { y: 500, height: 40 });
  assert(result !== null, 'sólo la medición del evento más reciente se aplica');
  assertEqual(rec.calls.length, 1, 'un único scrollTo real para dos eventos de teclado seguidos');
});

test('13) Callback pendiente se cancela al desmontar el panel', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  const gen = controller.keyboardShown(300);
  controller.unmount();
  const result = controller.resolveFieldMeasurement(gen as number, { y: 500, height: 40 });
  assertEqual(result, null, 'una medición que resuelve después del desmontaje nunca se aplica');
  assertEqual(rec.calls.length, 0, 'nunca se llama a scrollTo tras el desmontaje');
});

test('14) Callback del alumno anterior no mueve al alumno nuevo (equivalente explícito de la transición grupal)', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  const genPrev = controller.focusField(FIELD_A);
  controller.footerLayoutChanged(450);
  controller.keyboardShown(300);

  // El alumno anterior se completa: se limpia el campo activo y se abre el
  // bloque del alumno nuevo sin que todavía toque ningún campo.
  controller.clearActiveField();

  // La medición del alumno ANTERIOR llega tarde (measureInWindow real,
  // asíncrono) — nunca debe desplazar la pantalla del alumno nuevo.
  const result = controller.resolveFieldMeasurement(genPrev, { y: 50, height: 20 });
  assertEqual(result, null, 'la medición del alumno anterior, resuelta después de la transición, se descarta');
  assertEqual(controller.getActiveField(), null, 'no queda ningún campo activo hasta que el alumno nuevo toque uno');
});

test('16) El objetivo calculado siempre deja el extremo inferior del campo por encima del límite real (cursor dentro del viewport visible)', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  controller.focusField(FIELD_A);
  controller.footerLayoutChanged(500);
  const gen = controller.keyboardShown(300);
  const fieldPageY = 600;
  const fieldHeight = 50;
  const result = controller.resolveFieldMeasurement(gen as number, { y: fieldPageY, height: fieldHeight });
  assert(result !== null, 'debía corregir');
  // El delta aplicado deja el extremo inferior del campo exactamente a
  // `margin` px del límite real (500 - 40 = 460); tras desplazar `scrolledTo`
  // px, el campo (que no se mueve en el contenido) queda visualmente en
  // fieldPageY - scrolledTo, con extremo inferior en esa posición + height.
  const newFieldBottomOnScreen = fieldPageY + fieldHeight - (result?.scrolledTo ?? 0);
  assertEqual(newFieldBottomOnScreen, 460, 'el extremo inferior del campo queda exactamente a 40px del límite real — ni tapado, ni de más');
});

test('21) Tarea personalizada de un integrante grupal: cada participante es un FieldKey distinto — nunca se confunde uno con otro', () => {
  const rec = makeRecorder();
  const controller = createActiveFieldVisibilityController({ scrollTo: rec.scrollTo, margin: 40, isFieldFocused: () => true });
  const participant1Field: FieldKey = { participant: 1 };
  const participant2Field: FieldKey = { participant: 2 };

  controller.focusField(participant1Field);
  controller.footerLayoutChanged(450);
  controller.keyboardShown(300);
  assertEqual(controller.getActiveField(), participant1Field, 'participante 1 activo');

  controller.clearActiveField();
  const gen2 = controller.focusField(participant2Field);
  assertEqual(controller.getActiveField(), participant2Field, 'participante 2 activo — nunca el mismo objeto que el 1');
  const result = controller.resolveFieldMeasurement(gen2, { y: 500, height: 40 });
  assert(result !== null, 'la tarea personalizada del participante 2 se corrige de forma independiente');
});
