// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentIdempotency.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural,
 * "IDENTIDAD SIN COLISIONES"): prueba adversarial de `buildTrainingChargeId`
 * — construida específicamente para que una concatenación ingenua con "_"
 * colisionaría, y demuestra que la codificación real (longitud + contenido)
 * no lo hace.
 */
import { buildTrainingChargeId } from '../paymentIdempotency.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('8a) buildTrainingChargeId: mismos datos producen siempre el mismo id (determinístico)', () => {
  assertEqual(
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    'idempotente ante los mismos datos'
  );
});

test('8b) buildTrainingChargeId: prueba adversarial — un agreementId con "_" nunca colisiona con otro par (agreement, alumno) que a simple concatenación daría el mismo texto', () => {
  // Concatenación ingenua `${a}_${b}_${period}` produciría EXACTAMENTE el
  // mismo string para estos dos pares distintos:
  //   par A: agreement = "training_agreement_X", alumno = "Y"
  //   par B: agreement = "training_agreement",   alumno = "X_Y"
  // porque el "_" que separa agreement de alumno es indistinguible del "_"
  // que ya está DENTRO de "training_agreement_X". La identidad real
  // (longitud + contenido) nunca debe colisionar acá.
  const idA = buildTrainingChargeId('training_agreement_X', 'Y', '2026-08');
  const idB = buildTrainingChargeId('training_agreement', 'X_Y', '2026-08');
  assert(idA !== idB, 'dos pares (agreement, alumno) real y legítimamente distintos nunca deben producir el mismo id, aunque su concatenación cruda coincida');
});

test('8c) buildTrainingChargeId: prueba adversarial — un studentId que "roba" caracteres del período tampoco colisiona', () => {
  const idA = buildTrainingChargeId('qa_agreement', 'qa_alumno', '2026-08');
  const idB = buildTrainingChargeId('qa_agreement', 'qa_alumno_2026-08', '');
  assert(idA !== idB, 'un alumno cuyo id "imita" el período real nunca debe coincidir con el id real de ese período');
});

test('8d) buildTrainingChargeId: agreements distintos con el mismo alumno y período nunca colisionan', () => {
  assert(
    buildTrainingChargeId('qa_agreement_a', 'qa_alumno_1', '2026-08') !==
      buildTrainingChargeId('qa_agreement_b', 'qa_alumno_1', '2026-08'),
    'series distintas del mismo alumno y mes producen ids distintos'
  );
});

test('8e) buildTrainingChargeId: alumnos distintos con el mismo agreement y período nunca colisionan', () => {
  assert(
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_a', '2026-08') !==
      buildTrainingChargeId('qa_agreement_1', 'qa_alumno_b', '2026-08'),
    'alumnos distintos de la misma serie y mes producen ids distintos'
  );
});

test('8f) buildTrainingChargeId: cadena vacía en un componente nunca colisiona con un valor real', () => {
  assert(
    buildTrainingChargeId('', 'qa_alumno_1', '2026-08') !== buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    'un agreementId vacío (caso degenerado, nunca debería ocurrir en la práctica) igual nunca colisiona con uno real'
  );
});
