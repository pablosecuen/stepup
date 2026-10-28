// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/studentCollectionEligibility.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): pruebas de la única regla de dominio que decide si
 * un alumno es candidato a aparecer en cualquier superficie operativa de
 * cobro (`isStudentEligibleForCollectionsDisplay`,
 * `studentCollectionEligibility.ts`). Deliberadamente sin identidad de
 * alumno alguna — es una función pura de un solo argumento (`StudentStatus`).
 */
import { isStudentEligibleForCollectionsDisplay } from '../studentCollectionEligibility.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('activo: elegible', () => {
  assertEqual(isStudentEligibleForCollectionsDisplay('activo'), true, 'un alumno activo siempre es elegible');
});

test('pausado: NO elegible', () => {
  assertEqual(isStudentEligibleForCollectionsDisplay('pausado'), false, 'pausado nunca es elegible para el circuito operativo');
});

test('inactivo: NO elegible', () => {
  assertEqual(isStudentEligibleForCollectionsDisplay('inactivo'), false, 'inactivo nunca es elegible para el circuito operativo');
});

test('archivado: NO elegible', () => {
  assertEqual(isStudentEligibleForCollectionsDisplay('archivado'), false, 'archivado nunca es elegible para el circuito operativo');
});

test('pausado, inactivo y archivado se tratan exactamente igual (misma regla, sin distinción entre ellos)', () => {
  assertEqual(
    isStudentEligibleForCollectionsDisplay('pausado'),
    isStudentEligibleForCollectionsDisplay('inactivo'),
    'pausado e inactivo dan el mismo resultado'
  );
  assertEqual(
    isStudentEligibleForCollectionsDisplay('inactivo'),
    isStudentEligibleForCollectionsDisplay('archivado'),
    'inactivo y archivado dan el mismo resultado'
  );
});
