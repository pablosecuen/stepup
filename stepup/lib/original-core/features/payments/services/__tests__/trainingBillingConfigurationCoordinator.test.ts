// Puerto VERBATIM del original (`src/features/payments/services/__tests__/trainingBillingConfigurationCoordinator.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural de
 * `aba94e0`, punto 10: "PRUEBAS DE FALLO"): inyección de fallos en cada paso
 * del coordinador único (`runTrainingBillingConfiguration`), más doble
 * toque y concurrencia usando el store REAL con cola (nunca un doble
 * mock que reimplemente la cola por su cuenta).
 *
 * Corrección 2026-09-14, segunda ronda (a pedido de Joaquín — revisión
 * INDEPENDIENTE que encontró fallas reales todavía presentes en el
 * coordinador anterior): reescrito contra el nuevo contrato —
 * `linkRulesToAgreement`/`readLinkedAgreementIds` (plural, reciben la
 * lista completa de `recurrenceId`) y el plan declara explícitamente
 * `recurrenceIdsToLink`/`expectedChargeIds`. Pruebas nuevas: vincular
 * VARIAS reglas (verificar TODAS, no sólo la primera) y el caso donde
 * correspondía al menos un cargo pero el motor de generación devuelve
 * vacío (debe fallar, nunca declarar éxito por `[].every(...)`).
 */
import type { TrainingBillingAgreement } from '../../types/index.ts';
import { runTrainingBillingConfiguration, type TrainingBillingConfigurationDeps, type TrainingBillingConfigurationPlan } from '../trainingBillingConfigurationCoordinator.ts';
import { createTrainingBillingAgreementsStoreController, findTrainingBillingAgreement, type TrainingBillingAgreementsPersistenceAdapter } from '../../hooks/trainingBillingAgreementsStore.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

function agreementFixture(overrides: Partial<TrainingBillingAgreement> = {}): TrainingBillingAgreement {
  return {
    id: 'qa_agreement_1',
    monthlyFee: 15000,
    startPeriod: '2026-08',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function planFixture(overrides: Partial<TrainingBillingConfigurationPlan> = {}): TrainingBillingConfigurationPlan {
  return {
    agreement: agreementFixture(),
    startPeriod: '2026-08',
    endPeriod: '2026-08',
    recurrenceIdsToLink: ['qa_recurrence_1'],
    expectedChargeIds: ['qa_charge_1'],
    ...overrides,
  };
}

/** Deps 100% "felices" por defecto — cada prueba pisa sólo lo que necesita fallar. */
function happyDeps(overrides: Partial<TrainingBillingConfigurationDeps> = {}): TrainingBillingConfigurationDeps {
  const linkedIds = new Map<string, string>();
  const persistedCharges = new Set<string>();
  return {
    upsertAgreement: async () => {},
    readAgreement: async (id) => (id === agreementFixture().id ? agreementFixture() : null),
    linkRulesToAgreement: async (agreementId, recurrenceIds) => {
      recurrenceIds.forEach((id) => linkedIds.set(id, agreementId));
    },
    readLinkedAgreementIds: async (recurrenceIds) => {
      const map: Record<string, string | null | undefined> = {};
      recurrenceIds.forEach((id) => {
        map[id] = linkedIds.get(id) ?? null;
      });
      return map;
    },
    generateCharges: async () => {
      // Genera exactamente los `expectedChargeIds` del plan por defecto —
      // cada prueba que necesite un desajuste lo pisa explícitamente.
      planFixture().expectedChargeIds.forEach((id) => persistedCharges.add(id));
      return { createdChargeIds: [...persistedCharges] };
    },
    readExistingChargeIds: async (chargeIds) => chargeIds.filter((id) => persistedCharges.has(id)),
    ...overrides,
  };
}

asyncTest('éxito: recorre los 6 pasos en orden y devuelve ok con los cargos creados', async () => {
  const result = await runTrainingBillingConfiguration(planFixture(), happyDeps());
  assertEqual(result.ok, true, 'éxito');
  assertEqual(result.createdChargeIds.length, 1, 'un cargo creado');
  assertEqual(result.stage, undefined, 'sin stage en el éxito');
});

// ---------------------------------------------------------------------------
// Falla al guardar acuerdo
// ---------------------------------------------------------------------------
asyncTest('falla al guardar el acuerdo: nunca vincula la regla ni genera cargos — stage agreement_persist_failed', async () => {
  let ruleLinked = false;
  let chargesGenerated = false;
  const deps = happyDeps({
    upsertAgreement: async () => {
      throw new Error('fallo simulado al guardar el acuerdo');
    },
    linkRulesToAgreement: async () => {
      ruleLinked = true;
    },
    generateCharges: async () => {
      chargesGenerated = true;
      return { createdChargeIds: [] };
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.ok, false, 'falla');
  assertEqual(result.stage, 'agreement_persist_failed', 'stage correcto');
  assert(!ruleLinked, 'nunca llega a vincular la regla');
  assert(!chargesGenerated, 'nunca llega a generar cargos');
  assertEqual(result.createdChargeIds.length, 0, 'cero cargos huérfanos');
});

// ---------------------------------------------------------------------------
// Falla al verificar el acuerdo (releído no coincide)
// ---------------------------------------------------------------------------
asyncTest('falla al verificar el acuerdo (releído no coincide con lo persistido): nunca vincula la regla ni genera cargos', async () => {
  let ruleLinked = false;
  const deps = happyDeps({
    readAgreement: async () => agreementFixture({ monthlyFee: 999 }), // no coincide con el plan real
    linkRulesToAgreement: async () => {
      ruleLinked = true;
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.ok, false, 'falla');
  assertEqual(result.stage, 'agreement_verify_failed', 'stage correcto');
  assert(!ruleLinked, 'nunca llega a vincular la regla si el acuerdo no se verificó');
});

asyncTest('falla al releer el acuerdo (excepción real de lectura): stage agreement_verify_failed', async () => {
  const deps = happyDeps({
    readAgreement: async () => {
      throw new Error('fallo simulado de lectura');
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.stage, 'agreement_verify_failed', 'stage correcto ante una excepción de lectura, no sólo un valor discrepante');
});

// ---------------------------------------------------------------------------
// Falla al guardar/vincular la(s) regla(s)
// ---------------------------------------------------------------------------
asyncTest('falla al vincular la regla: el acuerdo QUEDA persistido (recuperable — nunca se revierte a ciegas) pero nunca se generan cargos', async () => {
  let chargesGenerated = false;
  const deps = happyDeps({
    linkRulesToAgreement: async () => {
      throw new Error('fallo simulado al vincular la regla');
    },
    generateCharges: async () => {
      chargesGenerated = true;
      return { createdChargeIds: [] };
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.ok, false, 'falla');
  assertEqual(result.stage, 'rule_link_failed', 'stage correcto');
  assert(!chargesGenerated, 'nunca genera cargos sin la regla vinculada y verificada');
  assertEqual(result.createdChargeIds.length, 0, 'cero cargos huérfanos');
});

asyncTest('falla al verificar la vinculación (releída no coincide): nunca genera cargos', async () => {
  let chargesGenerated = false;
  const deps = happyDeps({
    linkRulesToAgreement: async () => {}, // "tiene éxito" pero en los hechos no quedó bien vinculada
    readLinkedAgreementIds: async (recurrenceIds) => {
      const map: Record<string, string | null | undefined> = {};
      recurrenceIds.forEach((id) => {
        map[id] = 'otro_id_distinto';
      });
      return map;
    },
    generateCharges: async () => {
      chargesGenerated = true;
      return { createdChargeIds: [] };
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.stage, 'rule_verify_failed', 'stage correcto');
  assert(!chargesGenerated, 'nunca genera cargos si la verificación de vínculo no coincide');
});

// ---------------------------------------------------------------------------
// Punto 8 de la revisión ("IDENTIDAD SIN COLISIONES"/verificar TODAS las
// reglas): un linaje de VARIAS reglas donde sólo la primera queda vinculada
// nunca puede pasar como éxito.
// ---------------------------------------------------------------------------
asyncTest('vincula varias reglas (linaje histórico): si sólo la primera queda vinculada, falla — nunca se conforma con verificar una sola', async () => {
  const plan = planFixture({ recurrenceIdsToLink: ['qa_recurrence_1', 'qa_recurrence_2', 'qa_recurrence_3'] });
  let chargesGenerated = false;
  const deps = happyDeps({
    linkRulesToAgreement: async () => {}, // simula una vinculación real que sólo alcanzó a la primera regla
    readLinkedAgreementIds: async (recurrenceIds) => {
      const map: Record<string, string | null | undefined> = {};
      recurrenceIds.forEach((id, index) => {
        map[id] = index === 0 ? agreementFixture().id : null; // sólo la primera quedó vinculada de verdad
      });
      return map;
    },
    generateCharges: async () => {
      chargesGenerated = true;
      return { createdChargeIds: [] };
    },
  });
  const result = await runTrainingBillingConfiguration(plan, deps);
  assertEqual(result.ok, false, 'falla — no todas las reglas del linaje quedaron vinculadas');
  assertEqual(result.stage, 'rule_verify_failed', 'stage correcto');
  assert(!chargesGenerated, 'nunca genera cargos si falta vincular alguna regla del linaje');
});

asyncTest('vincula varias reglas (linaje histórico): éxito real sólo cuando TODAS quedan vinculadas', async () => {
  const plan = planFixture({ recurrenceIdsToLink: ['qa_recurrence_1', 'qa_recurrence_2', 'qa_recurrence_3'] });
  const deps = happyDeps();
  const result = await runTrainingBillingConfiguration(plan, deps);
  assertEqual(result.ok, true, 'éxito real — las tres reglas del linaje quedaron vinculadas');
});

// ---------------------------------------------------------------------------
// Falla al generar cargos — la configuración ya verificada se conserva
// ---------------------------------------------------------------------------
asyncTest('falla al generar cargos: la configuración (acuerdo + vínculo) ya verificada se conserva, nunca se revierte', async () => {
  const deps = happyDeps({
    generateCharges: async () => {
      throw new Error('fallo simulado de generación');
    },
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.ok, false, 'falla');
  assertEqual(result.stage, 'charge_generation_failed', 'stage correcto');
  assertEqual(result.createdChargeIds.length, 0, 'sin cargos reportados');
});

asyncTest('falla al verificar los cargos generados (no se pueden releer): reporta los ids generados pero result.ok es false', async () => {
  const deps = happyDeps({
    readExistingChargeIds: async () => [], // ninguno de los "esperados" se puede releer
  });
  const result = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(result.ok, false, 'falla');
  assertEqual(result.stage, 'charge_verify_failed', 'stage correcto');
});

// ---------------------------------------------------------------------------
// Punto 6 de la revisión ("cero cargos generados puede pasar como
// verificación correcta aunque correspondía crear cargos" — `[].every(...)`
// vacuamente `true`): el plan esperaba cargos reales; el motor de
// generación devuelve un array vacío (`createdChargeIds: []`) — NUNCA debe
// declararse éxito sólo porque ese array vacío "no contradice" nada.
// ---------------------------------------------------------------------------
asyncTest('el plan esperaba cargos pero el generador devuelve vacío: falla, nunca declara éxito por [].every(...)', async () => {
  const plan = planFixture({ expectedChargeIds: ['qa_charge_1', 'qa_charge_2'] });
  const deps = happyDeps({
    generateCharges: async () => ({ createdChargeIds: [] }), // el motor no reporta nada creado
    readExistingChargeIds: async () => [], // y ninguno de los esperados existe realmente
  });
  const result = await runTrainingBillingConfiguration(plan, deps);
  assertEqual(result.ok, false, 'falla — el plan esperaba cargos reales que nunca se verificaron persistidos');
  assertEqual(result.stage, 'charge_verify_failed', 'stage correcto');
});

asyncTest('plan legítimo de cero cargos esperados: [] es éxito real cuando el plan mismo determinó cero obligaciones', async () => {
  const plan = planFixture({ expectedChargeIds: [] });
  const deps = happyDeps({
    generateCharges: async () => ({ createdChargeIds: [] }),
    readExistingChargeIds: async () => [],
  });
  const result = await runTrainingBillingConfiguration(plan, deps);
  assertEqual(result.ok, true, 'éxito legítimo — el plan nunca esperó ningún cargo');
});

asyncTest('cargos ya existentes de una corrida anterior: el generador no crea nada nuevo pero los esperados YA están persistidos — éxito', async () => {
  const plan = planFixture({ expectedChargeIds: ['qa_charge_1'] });
  const deps = happyDeps({
    generateCharges: async () => ({ createdChargeIds: [] }), // idempotente: ya existía, no crea nada nuevo
    readExistingChargeIds: async (chargeIds) => chargeIds, // ya estaban todos persistidos de antes
  });
  const result = await runTrainingBillingConfiguration(plan, deps);
  assertEqual(result.ok, true, 'éxito — los cargos esperados ya existían, generar cero de nuevo es correcto');
});

// ---------------------------------------------------------------------------
// Reintento después de cada fallo: la MISMA llamada, repetida, tiene éxito
// (idempotente) una vez que la dependencia deja de fallar.
// ---------------------------------------------------------------------------
asyncTest('reintento después de un fallo de generación: la segunda corrida (misma config ya verificada) sí genera los cargos correctamente', async () => {
  let shouldFailGeneration = true;
  const persistedCharges = new Set<string>();
  const deps = happyDeps({
    generateCharges: async () => {
      if (shouldFailGeneration) throw new Error('fallo simulado, primera vez');
      planFixture().expectedChargeIds.forEach((id) => persistedCharges.add(id));
      return { createdChargeIds: [...persistedCharges] };
    },
    readExistingChargeIds: async (chargeIds) => chargeIds.filter((id) => persistedCharges.has(id)),
  });

  const firstAttempt = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(firstAttempt.ok, false, 'primer intento falla (generación)');

  shouldFailGeneration = false;
  const secondAttempt = await runTrainingBillingConfiguration(planFixture(), deps);
  assertEqual(secondAttempt.ok, true, 'el reintento tiene éxito');
  assertEqual(secondAttempt.createdChargeIds.length, 1, 'genera exactamente el cargo que faltaba');
});

// ---------------------------------------------------------------------------
// Doble toque / dos operaciones concurrentes — usando el store REAL (con
// cola) como dependencia, no un mock que reimplemente la serialización.
// ---------------------------------------------------------------------------
asyncTest('doble toque: dos llamadas concurrentes al coordinador con el MISMO plan, contra el store real, nunca duplican el acuerdo ni los cargos', async () => {
  const agreementStore = { persisted: [] as TrainingBillingAgreement[] };
  const agreementAdapter: TrainingBillingAgreementsPersistenceAdapter = {
    readAll: async () => agreementStore.persisted,
    writeAll: async (entries) => {
      agreementStore.persisted = entries;
    },
  };
  const agreementController = createTrainingBillingAgreementsStoreController(agreementAdapter);
  await agreementController.hydrate();

  const linkedIds = new Map<string, string>();
  const chargesStore = new Set<string>();
  let generateCallCount = 0;

  function buildDeps(): TrainingBillingConfigurationDeps {
    return {
      upsertAgreement: async (agreement) => {
        await agreementController.upsert(agreement);
      },
      readAgreement: async (id) => findTrainingBillingAgreement(agreementController.getSnapshot(), id),
      linkRulesToAgreement: async (agreementId, recurrenceIds) => {
        recurrenceIds.forEach((id) => linkedIds.set(id, agreementId));
      },
      readLinkedAgreementIds: async (recurrenceIds) => {
        const map: Record<string, string | null | undefined> = {};
        recurrenceIds.forEach((id) => {
          map[id] = linkedIds.get(id) ?? null;
        });
        return map;
      },
      generateCharges: async (agreementId, startPeriod) => {
        generateCallCount += 1;
        const chargeId = `charge_${agreementId}_${startPeriod}`;
        if (chargesStore.has(chargeId)) return { createdChargeIds: [] }; // idempotente, mismo criterio que el motor real
        chargesStore.add(chargeId);
        return { createdChargeIds: [chargeId] };
      },
      readExistingChargeIds: async (chargeIds) => chargeIds.filter((id) => chargesStore.has(id)),
    };
  }

  const plan = planFixture({ expectedChargeIds: ['charge_qa_agreement_1_2026-08'] });
  const [resultA, resultB] = await Promise.all([
    runTrainingBillingConfiguration(plan, buildDeps()),
    runTrainingBillingConfiguration(plan, buildDeps()),
  ]);

  assert(resultA.ok, 'primera llamada exitosa');
  assert(resultB.ok, 'segunda llamada exitosa (idempotente, no un error)');
  assertEqual(agreementStore.persisted.length, 1, 'cero acuerdos duplicados/perdidos — sigue existiendo exactamente uno');
  assertEqual(chargesStore.size, 1, 'cero cargos duplicados — sigue existiendo exactamente uno, sin importar cuántas veces se haya llamado a generateCharges');
  assert(generateCallCount >= 1, 'la generación se invocó al menos una vez');
});
