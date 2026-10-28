// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/currencyAmountInput.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { digitsOnly, formatAmountPreviewARS, formatIntegerThousands, parseAmountInputToInteger, validateAmountInput } from '../currencyAmountInput.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// Corrección 2026-07-30 (a pedido de Joaquín — editar monto mensual): el
// campo "Nuevo monto" nunca guarda el texto formateado como valor real —
// cada tecla se reduce a un entero canónico (digitsOnly + Number) y el
// texto mostrado siempre se regenera desde ese entero. Estas pruebas
// cubren los escenarios 8 y 9 del pedido: formato con separadores de
// miles, y rechazo de vacío/cero/negativo/letras/NaN/infinito.
// ---------------------------------------------------------------------------

test('digitsOnly descarta cualquier caracter que no sea 0-9', () => {
  assertEqual(digitsOnly('$ 100.800'), '100800', 'quita $, espacio y punto');
  assertEqual(digitsOnly('abc123def456'), '123456', 'quita letras intercaladas');
  assertEqual(digitsOnly('-1000'), '1000', 'quita el signo negativo (nunca se admite un negativo real)');
  assertEqual(digitsOnly(''), '', 'string vacío queda vacío');
});

test('parseAmountInputToInteger: escenario 1 del pedido — 1.008.000 corregido a 100.800', () => {
  assertEqual(parseAmountInputToInteger('1.008.000'), 1008000, 'importe original mal ingresado');
  assertEqual(parseAmountInputToInteger('100.800'), 100800, 'importe corregido');
});

test('parseAmountInputToInteger descarta ceros iniciales sin que el usuario los tenga que borrar', () => {
  assertEqual(parseAmountInputToInteger('0100800'), 100800, 'un cero inicial nunca se cuela en el valor guardado');
  assertEqual(parseAmountInputToInteger('000'), 0, 'sólo ceros se reduce a 0 (luego rechazado por validateAmountInput)');
});

test('parseAmountInputToInteger: campo vacío o sin dígitos devuelve null (nunca NaN)', () => {
  assertEqual(parseAmountInputToInteger(''), null, 'campo vacío');
  assertEqual(parseAmountInputToInteger('$'), null, 'sólo símbolo de moneda, sin dígitos');
  assertEqual(parseAmountInputToInteger('abc'), null, 'sólo letras, sin dígitos');
});

test('parseAmountInputToInteger nunca guarda puntos, espacios ni el símbolo $ en el valor interno', () => {
  const parsed = parseAmountInputToInteger('$ 1.008.000');
  assertEqual(parsed, 1008000, 'el entero interno es puro, sin separadores');
  assertEqual(String(parsed).includes('.'), false, 'la representación interna nunca tiene puntos');
});

test('formatIntegerThousands: separadores de miles en formato argentino (punto cada tres cifras)', () => {
  assertEqual(formatIntegerThousands(1000), '1.000', '1000 → 1.000');
  assertEqual(formatIntegerThousands(10000), '10.000', '10000 → 10.000');
  assertEqual(formatIntegerThousands(100800), '100.800', '100800 → 100.800');
  assertEqual(formatIntegerThousands(1008000), '1.008.000', '1008000 → 1.008.000');
});

test('formatAmountPreviewARS antepone "$ " al importe formateado', () => {
  assertEqual(formatAmountPreviewARS(100800), '$ 100.800', 'vista previa del escenario real de Rocío corregido');
  assertEqual(formatAmountPreviewARS(1008000), '$ 1.008.000', 'vista previa del importe mal ingresado original');
  assertEqual(formatAmountPreviewARS(null), '$ 0', 'sin importe todavía, vista previa muestra $ 0');
});

test('validateAmountInput rechaza vacío (null)', () => {
  const result = validateAmountInput(null);
  assertEqual(result.isValid, false, 'campo vacío nunca es válido');
  assert(result.error !== null, 'siempre hay un mensaje de error para mostrar debajo del campo');
});

test('validateAmountInput rechaza cero', () => {
  const result = validateAmountInput(0);
  assertEqual(result.isValid, false, 'cero nunca es un monto mensual válido');
});

test('validateAmountInput rechaza negativos', () => {
  const result = validateAmountInput(-500);
  assertEqual(result.isValid, false, 'un importe negativo nunca es válido');
});

test('validateAmountInput rechaza NaN e Infinito', () => {
  assertEqual(validateAmountInput(NaN).isValid, false, 'NaN nunca es válido');
  assertEqual(validateAmountInput(Infinity).isValid, false, 'Infinity nunca es válido');
  assertEqual(validateAmountInput(-Infinity).isValid, false, '-Infinity nunca es válido');
});

test('validateAmountInput rechaza decimales (todavía no se admiten)', () => {
  const result = validateAmountInput(100800.5);
  assertEqual(result.isValid, false, 'sin decimales por ahora');
});

test('validateAmountInput acepta un entero positivo válido', () => {
  const result = validateAmountInput(100800);
  assertEqual(result.isValid, true, '100.800 es un importe válido');
  assertEqual(result.error, null, 'sin mensaje de error cuando es válido');
});

test('letras nunca llegan al valor canónico: "cien mil" se reduce a los dígitos que contenga, o a null', () => {
  // "cien mil" no tiene dígitos → null → validateAmountInput lo rechaza.
  assertEqual(parseAmountInputToInteger('cien mil'), null, 'sin dígitos, se rechaza en el parseo, no en el guardado');
  assert(!validateAmountInput(parseAmountInputToInteger('cien mil')).isValid, 'y por lo tanto tampoco pasa la validación');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-02 (a pedido de Joaquín — formato del monto al crear un
// alumno): pruebas de las "PRUEBAS OBLIGATORIAS" pedidas explícitamente,
// simulando el ciclo real de un TextInput controlado — CurrencyInput.tsx
// SIEMPRE pasa el texto COMPLETO actual (formateado) a onChangeText, nunca
// sólo la tecla nueva, así que "editar" en RN es equivalente a "volver a
// parsear el texto formateado completo".
// ---------------------------------------------------------------------------

test('escribir 154700 muestra "$ 154.700" y el valor persistido es el entero 154700', () => {
  const parsed = parseAmountInputToInteger('154700');
  assertEqual(parsed, 154700, 'el valor persistido es el entero sin formato');
  assertEqual(formatAmountPreviewARS(parsed), '$ 154.700', 'la vista muestra $ 154.700');
});

test('editar el texto ya formateado "$ 154.700" nunca produce 1.547.000 (no se multiplica por 10 al editar)', () => {
  // RN entrega el valor COMPLETO del campo (ya formateado) en cada
  // onChangeText — nunca sólo el caracter nuevo — así que "agregar un 0 al
  // final" en la UI equivale a volver a parsear "$ 154.700" + "0".
  const editedText = `${formatAmountPreviewARS(154700)}0`; // "$ 154.7000" (agregó un dígito al final)
  assertEqual(parseAmountInputToInteger(editedText), 1547000, 'agregar un dígito real sí cambia el valor — pero de forma predecible, nunca ×10 fantasma');
  // El escenario del bug real (multiplicar por 10 SIN que la profesora haya
  // tecleado nada nuevo) no puede ocurrir: volver a parsear el mismo texto
  // formateado, sin editarlo, siempre da el mismo entero.
  assertEqual(parseAmountInputToInteger(formatAmountPreviewARS(154700)), 154700, 'reparsear el mismo texto formateado sin tocarlo conserva el valor exacto');
});

test('borrar un dígito del importe actualiza correctamente el valor (nunca deja basura ni NaN)', () => {
  // La profesora ve "$ 154.700" y borra el último dígito visible → el campo
  // controlado le pasa "$ 154.70" (sin el último "0") a onChangeText.
  assertEqual(parseAmountInputToInteger('$ 154.70'), 15470, 'borrar el último dígito visible da el entero esperado');
});

test('borrar todo el campo deja el valor en null, nunca en 0', () => {
  assertEqual(parseAmountInputToInteger(''), null, 'campo vacío es null, no cero — el llamador nunca debe inventar un 0');
});

test('pegar "154700" funciona igual que escribirlo', () => {
  assertEqual(parseAmountInputToInteger('154700'), 154700, 'pegado sin formato');
});

test('pegar "$ 154.700" produce 154700 (nunca 1540700 ni ningún otro valor corrompido)', () => {
  assertEqual(parseAmountInputToInteger('$ 154.700'), 154700, 'pegado con el formato completo produce el mismo entero');
});

test('cerrar y reabrir mantiene "$ 154.700": formatear el entero persistido siempre reproduce la misma vista', () => {
  const persisted = 154700;
  assertEqual(formatAmountPreviewARS(persisted), '$ 154.700', 'reabrir con el mismo entero persistido muestra exactamente el mismo texto');
});
