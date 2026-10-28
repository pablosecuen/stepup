// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/budgetDistribution.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { DEFAULT_BUDGET_DISTRIBUTION, adjustNeeds, adjustSavings, adjustWants, applyBudgetDistribution, normalizeBudgetDistribution, resetBudgetDistribution, type BudgetDistribution } from '../budgetDistribution.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Fase financiera — "Plan de distribución 50/30/20" (a pedido de Joaquín):
 * pruebas del motor puro de ajuste de porcentajes. Ver reglas exactas en
 * `budgetDistribution.ts` — nunca reimplementadas acá, sólo verificadas.
 */

function total(distribution: BudgetDistribution): number {
  return distribution.needs + distribution.wants + distribution.savings;
}

test('distribución inicial es exactamente 50/30/20', () => {
  assertEqual(DEFAULT_BUDGET_DISTRIBUTION.needs, 50, 'necesidades');
  assertEqual(DEFAULT_BUDGET_DISTRIBUTION.wants, 30, 'gustos');
  assertEqual(DEFAULT_BUDGET_DISTRIBUTION.savings, 20, 'ahorro');
  assertEqual(total(DEFAULT_BUDGET_DISTRIBUTION), 100, 'suman 100');
});

test('resetBudgetDistribution devuelve exactamente 50/30/20', () => {
  const reset = resetBudgetDistribution();
  assertEqual(reset.needs, 50, 'necesidades');
  assertEqual(reset.wants, 30, 'gustos');
  assertEqual(reset.savings, 20, 'ahorro');
});

// ---------------------------------------------------------------------------
// Mover "Necesidades": la diferencia se reparte proporcionalmente entre las
// otras dos según su peso actual.
// ---------------------------------------------------------------------------

test('mover Necesidades reparte la diferencia proporcionalmente entre Gustos y Ahorro', () => {
  const result = adjustNeeds(DEFAULT_BUDGET_DISTRIBUTION, 60); // +10
  assertEqual(result.needs, 60, 'necesidades sube al valor pedido');
  assertEqual(total(result), 100, 'sigue sumando 100');
  // wants:savings estaban en 30:20 (60%:40% del resto) — deben perder proporcionalmente
  assertEqual(result.wants, 24, 'gustos pierde el 60% de los 10 puntos (6)');
  assertEqual(result.savings, 16, 'ahorro pierde el 40% de los 10 puntos (4)');
});

test('mover Necesidades cuando Gustos y Ahorro están ambos en 0 reparte la diferencia por igual', () => {
  const base: BudgetDistribution = { needs: 100, wants: 0, savings: 0 };
  const result = adjustNeeds(base, 80); // -20
  assertEqual(result.needs, 80, 'necesidades baja al valor pedido');
  assertEqual(total(result), 100, 'sigue sumando 100');
  assertEqual(result.wants, 10, 'gustos recibe la mitad del sobrante');
  assertEqual(result.savings, 10, 'ahorro recibe la mitad del sobrante');
});

// ---------------------------------------------------------------------------
// Mover "Gustos": Necesidades queda fija, Ahorro absorbe la diferencia.
// ---------------------------------------------------------------------------

test('mover Gustos deja Necesidades fija y Ahorro absorbe toda la diferencia', () => {
  const result = adjustWants(DEFAULT_BUDGET_DISTRIBUTION, 40); // +10
  assertEqual(result.needs, 50, 'necesidades no se mueve');
  assertEqual(result.wants, 40, 'gustos sube al valor pedido');
  assertEqual(result.savings, 10, 'ahorro absorbe toda la diferencia');
  assertEqual(total(result), 100, 'sigue sumando 100');
});

test('mover Gustos hacia abajo también deja Necesidades fija', () => {
  const result = adjustWants(DEFAULT_BUDGET_DISTRIBUTION, 10); // -20
  assertEqual(result.needs, 50, 'necesidades no se mueve');
  assertEqual(result.wants, 10, 'gustos baja al valor pedido');
  assertEqual(result.savings, 40, 'ahorro absorbe toda la diferencia');
  assertEqual(total(result), 100, 'sigue sumando 100');
});

// ---------------------------------------------------------------------------
// Mover "Ahorro": la diferencia se reparte en partes iguales entre las
// otras dos; si una toca su límite, el resto se transfiere a la otra.
// ---------------------------------------------------------------------------

test('mover Ahorro reparte la diferencia en partes iguales entre Necesidades y Gustos', () => {
  const result = adjustSavings(DEFAULT_BUDGET_DISTRIBUTION, 30); // +10
  assertEqual(result.savings, 30, 'ahorro sube al valor pedido');
  assertEqual(result.needs, 45, 'necesidades pierde la mitad (5)');
  assertEqual(result.wants, 25, 'gustos pierde la mitad (5)');
  assertEqual(total(result), 100, 'sigue sumando 100');
});

test('mover Ahorro y transferir el remanente cuando una de las otras dos toca su límite', () => {
  // needs muy bajo: al subir savings, needs no puede bajar más de lo que tiene.
  const base: BudgetDistribution = { needs: 3, wants: 77, savings: 20 };
  const result = adjustSavings(base, 30); // +10, mitad para cada una (5) pero needs sólo tiene 3
  assertEqual(result.savings, 30, 'ahorro sube al valor pedido');
  assertEqual(result.needs, 0, 'necesidades no puede bajar de 0');
  assertEqual(total(result), 100, 'sigue sumando 100 pese al límite alcanzado');
});

// ---------------------------------------------------------------------------
// Límites 0/100 y ausencia de estados intermedios inválidos
// ---------------------------------------------------------------------------

test('ningún control puede bajar de 0', () => {
  const result = adjustNeeds(DEFAULT_BUDGET_DISTRIBUTION, -50);
  assertEqual(result.needs, 0, 'se recorta a 0, nunca negativo');
  assert(result.wants >= 0 && result.savings >= 0, 'las otras dos tampoco quedan negativas');
  assertEqual(total(result), 100, 'sigue sumando 100');
});

test('ningún control puede subir de 100', () => {
  const result = adjustWants(DEFAULT_BUDGET_DISTRIBUTION, 200);
  assertEqual(result.wants, 100, 'se recorta a 100, nunca más');
  assert(result.needs >= 0 && result.savings >= 0, 'las otras dos no quedan negativas');
  assertEqual(total(result), 100, 'sigue sumando 100');
});

// ---------------------------------------------------------------------------
// Cientos de movimientos pseudo-aleatorios: SIEMPRE suman exactamente 100 y
// nunca queda un valor fuera de [0, 100].
// ---------------------------------------------------------------------------

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test('cientos de movimientos pseudo-aleatorios: la suma siempre es exactamente 100 y ningún valor sale de [0, 100]', () => {
  const random = pseudoRandom(42);
  let distribution: BudgetDistribution = { ...DEFAULT_BUDGET_DISTRIBUTION };
  for (let i = 0; i < 500; i++) {
    const control = Math.floor(random() * 3);
    const value = Math.floor(random() * 140) - 20; // incluye valores fuera de [0,100] para probar el recorte
    if (control === 0) distribution = adjustNeeds(distribution, value);
    else if (control === 1) distribution = adjustWants(distribution, value);
    else distribution = adjustSavings(distribution, value);

    assertEqual(total(distribution), 100, `iteración ${i}: la suma siempre es 100`);
    assert(distribution.needs >= 0 && distribution.needs <= 100, `iteración ${i}: needs dentro de rango`);
    assert(distribution.wants >= 0 && distribution.wants <= 100, `iteración ${i}: wants dentro de rango`);
    assert(distribution.savings >= 0 && distribution.savings <= 100, `iteración ${i}: savings dentro de rango`);
  }
});

// ---------------------------------------------------------------------------
// applyBudgetDistribution: importes resultantes, con corrección de residuo
// de redondeo siempre sobre el último renglón (ahorro).
// ---------------------------------------------------------------------------

test('applyBudgetDistribution reparte el importe cobrado exactamente según los tres porcentajes', () => {
  const amounts = applyBudgetDistribution(100000, DEFAULT_BUDGET_DISTRIBUTION);
  assertEqual(amounts.needs, 50000, 'necesidades');
  assertEqual(amounts.wants, 30000, 'gustos');
  assertEqual(amounts.savings, 20000, 'ahorro');
  assertEqual(amounts.needs + amounts.wants + amounts.savings, 100000, 'suman el total exacto');
});

test('applyBudgetDistribution corrige el residuo de redondeo sobre el renglón de ahorro, nunca perdiendo ni inventando pesos', () => {
  const distribution: BudgetDistribution = { needs: 33, wants: 33, savings: 34 };
  const amounts = applyBudgetDistribution(100, distribution);
  assertEqual(amounts.needs + amounts.wants + amounts.savings, 100, 'la suma es exactamente el importe cobrado, sin perder ni inventar centavos');
});

test('applyBudgetDistribution con importe cero devuelve los tres en cero', () => {
  const amounts = applyBudgetDistribution(0, DEFAULT_BUDGET_DISTRIBUTION);
  assertEqual(amounts.needs, 0, 'necesidades');
  assertEqual(amounts.wants, 0, 'gustos');
  assertEqual(amounts.savings, 0, 'ahorro');
});

test('applyBudgetDistribution con importe negativo (nunca debería ocurrir, pero no debe romper) devuelve los tres en cero', () => {
  const amounts = applyBudgetDistribution(-500, DEFAULT_BUDGET_DISTRIBUTION);
  assertEqual(amounts.needs, 0, 'necesidades');
  assertEqual(amounts.wants, 0, 'gustos');
  assertEqual(amounts.savings, 0, 'ahorro');
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (a pedido de Joaquín — planificador 50/30/20 desequilibrado,
// video de evidencia WhatsApp 2026-08-24 22.03.37): causa raíz real —
// `onValueChange` del control dispara docenas de veces por segundo durante
// UN solo arrastre, y la versión anterior redondeaba los otros dos valores
// por separado, parchando el residuo siempre sobre el mismo (el mayor).
// Repetido muchas veces, ese sesgo se acumulaba: uno de los dos crecía muy
// por encima de su proporción real mientras el otro quedaba congelado —
// exactamente lo visible en el video. Esta prueba reproduce un arrastre
// continuo (muchos pasos de a 1 punto, como el control real) y verifica que
// las proporciones NUNCA se congelan ni se disparan de forma desequilibrada.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CORRECCIÓN adicional confirmada por simulación: si cada evento de un
// mismo arrastre recalcula tomando como base el resultado YA REDONDEADO del
// evento anterior (en vez de la distribución vigente al INICIAR el gesto),
// el reparto proporcional puede "congelarse" en uno de los dos valores no
// movidos durante todo el arrastre — mismo síntoma que el video, con causa
// más sutil que el simple parche de redondeo. La solución productiva
// (`BudgetDistributionCard.tsx` + `useBudgetDistribution.ts`) fija la
// distribución de referencia UNA vez por gesto (`onSlidingStart`) y la
// reutiliza para cada evento intermedio — estas pruebas verifican esa misma
// forma de uso (ancla fija), que es la que corre en producción.
// ---------------------------------------------------------------------------

test('arrastre continuo de "Necesidades" con la distribución de referencia fija por gesto: Gustos y Ahorro se reparten proporcionalmente en cada paso, nunca se congela ninguno', () => {
  // Reproduce la situación exacta del video: Gustos (mayor) y Ahorro
  // (menor) partiendo de valores dispares.
  const anchor: BudgetDistribution = { needs: 40, wants: 41, savings: 19 };
  let distribution = anchor;

  // Arrastre continuo needs: 40 -> 59 en pasos de a 1 (19 eventos
  // onValueChange, igual que dispara el control nativo durante un arrastre),
  // cada uno calculado contra la MISMA ancla — como hace la tarjeta real.
  for (let needs = 41; needs <= 59; needs++) {
    distribution = adjustNeeds(anchor, needs);
    assertEqual(total(distribution), 100, `paso needs=${needs}: sigue sumando 100`);
  }

  assertEqual(distribution.needs, 59, 'necesidades llega exactamente al valor arrastrado');
  // Con la ancla fija, Ahorro también debe haber bajado de forma
  // proporcional — nunca quedar clavado en su valor inicial (19) mientras
  // Gustos absorbe todo el remanente.
  assert(distribution.savings < anchor.savings, 'ahorro también cede proporcionalmente, nunca queda congelado en su valor inicial');
  assert(distribution.wants < anchor.wants, 'gustos también cede, nunca absorbe el 100% del remanente él solo');
  // Verifica proporcionalidad real: el cociente wants:savings final debe
  // seguir cerca del cociente original (41:19), nunca deformado por sesgo
  // de redondeo acumulado.
  const finalRatio = distribution.wants / Math.max(1, distribution.savings);
  const originalRatio = anchor.wants / anchor.savings;
  assert(Math.abs(finalRatio - originalRatio) < 0.3, `la proporción Gustos:Ahorro se mantiene cercana a la original (obtenida ${finalRatio.toFixed(2)}, esperada ~${originalRatio.toFixed(2)})`);
});

test('arrastre continuo de "Ahorro" con la distribución de referencia fija por gesto: Necesidades y Gustos se alternan parejo, ninguno queda congelado', () => {
  const anchor: BudgetDistribution = { ...DEFAULT_BUDGET_DISTRIBUTION }; // 50/30/20
  let distribution = anchor;
  for (let savings = 21; savings <= 40; savings++) {
    distribution = adjustSavings(anchor, savings);
    assertEqual(total(distribution), 100, `paso savings=${savings}: sigue sumando 100`);
  }
  // Con el bug de redondeo por pasos unitarios, "Necesidades" quedaba
  // congelada en 50 durante los 20 pasos completos (confirmado por
  // simulación) mientras "Gustos" absorbía el 100% de la diferencia. Con la
  // ancla fija, la diferencia (20 puntos) se reparte en partes IGUALES:
  // ambos deben haber cedido la misma cantidad exacta.
  assertEqual(distribution.needs, 40, 'necesidades cede su mitad exacta (10 puntos) de los 20 movidos');
  assertEqual(distribution.wants, 20, 'gustos cede su mitad exacta (10 puntos) de los 20 movidos');
});

test('arrastre continuo de "Necesidades" en sentido inverso, con la ancla actualizada al reiniciar el gesto: vuelve exactamente al valor original', () => {
  const forwardAnchor: BudgetDistribution = { needs: 40, wants: 41, savings: 19 };
  const afterForward = adjustNeeds(forwardAnchor, 59);
  // Al soltar y volver a tocar el control, el próximo gesto ancla desde la
  // distribución vigente en ESE momento (afterForward) — igual que
  // `onSlidingStart` en la tarjeta real.
  let distribution = afterForward;
  for (let needs = 58; needs >= 40; needs--) {
    distribution = adjustNeeds(afterForward, needs);
  }
  assertEqual(JSON.stringify(distribution), JSON.stringify(forwardAnchor), 'un segundo gesto completo, en sentido inverso, vuelve exactamente al valor original');
});

test('balancear dos veces con el mismo valor produce el mismo resultado (idempotente)', () => {
  const once = adjustNeeds(DEFAULT_BUDGET_DISTRIBUTION, 65);
  const twice = adjustNeeds(once, 65);
  assertEqual(JSON.stringify(once), JSON.stringify(twice), 'aplicar el mismo valor de nuevo no cambia nada');
});

test('ningún ajuste produce NaN ni valores infinitos, incluso con entradas inválidas', () => {
  const cases = [NaN, Infinity, -Infinity];
  for (const raw of cases) {
    const resultNeeds = adjustNeeds(DEFAULT_BUDGET_DISTRIBUTION, raw);
    const resultWants = adjustWants(DEFAULT_BUDGET_DISTRIBUTION, raw);
    const resultSavings = adjustSavings(DEFAULT_BUDGET_DISTRIBUTION, raw);
    for (const result of [resultNeeds, resultWants, resultSavings]) {
      assert(Number.isFinite(result.needs) && Number.isFinite(result.wants) && Number.isFinite(result.savings), `entrada ${raw}: ningún valor es NaN/Infinito`);
      assertEqual(total(result), 100, `entrada ${raw}: sigue sumando 100`);
    }
  }
});

test('applyBudgetDistribution usa los porcentajes ya equilibrados de un ajuste real, nunca los originales sin ajustar', () => {
  const adjusted = adjustNeeds(DEFAULT_BUDGET_DISTRIBUTION, 60);
  const amounts = applyBudgetDistribution(200000, adjusted);
  assertEqual(amounts.needs + amounts.wants + amounts.savings, 200000, 'los importes derivados suman el total exacto sobre la distribución ya equilibrada');
  assertEqual(amounts.needs, Math.round((200000 * adjusted.needs) / 100), 'el importe de necesidades usa el porcentaje ya equilibrado');
});

// ---------------------------------------------------------------------------
// normalizeBudgetDistribution: corrige valores históricos inválidos (suma
// distinta de 100, decimales, negativos, NaN) sin perderlos ni reemplazarlos
// por 50/30/20 salvo que sean totalmente irrecuperables.
// ---------------------------------------------------------------------------

test('normalizeBudgetDistribution conserva un valor histórico ya válido tal cual (nunca lo reinicia)', () => {
  const valid: BudgetDistribution = { needs: 45, wants: 35, savings: 20 };
  const result = normalizeBudgetDistribution(valid);
  assertEqual(JSON.stringify(result), JSON.stringify(valid), 'un valor válido no se toca');
});

test('normalizeBudgetDistribution corrige una suma histórica distinta de 100 preservando las proporciones', () => {
  const invalid: BudgetDistribution = { needs: 40, wants: 40, savings: 40 }; // suma 120
  const result = normalizeBudgetDistribution(invalid);
  assertEqual(total(result), 100, 'la suma queda exactamente 100');
  // Los tres pesaban igual (40/40/40) — deben seguir pesando igual entre sí.
  assert(Math.abs(result.needs - result.wants) <= 1 && Math.abs(result.wants - result.savings) <= 1, 'conserva la proporción igualitaria original');
});

test('normalizeBudgetDistribution corrige decimales y negativos sin perder la configuración original en proporción', () => {
  const invalid = { needs: 50.7, wants: -5, savings: 30.3 } as unknown as BudgetDistribution;
  const result = normalizeBudgetDistribution(invalid);
  assertEqual(total(result), 100, 'la suma queda exactamente 100');
  assert(result.needs >= 0 && result.wants >= 0 && result.savings >= 0, 'ningún valor queda negativo');
  assert(result.needs > result.savings, 'necesidades sigue siendo la proporción mayor, como en el original');
});

test('normalizeBudgetDistribution ante NaN en un valor lo trata como 0, sin romper los otros dos', () => {
  const invalid = { needs: NaN, wants: 30, savings: 20 } as unknown as BudgetDistribution;
  const result = normalizeBudgetDistribution(invalid);
  assertEqual(total(result), 100, 'la suma queda exactamente 100');
  assert(Number.isFinite(result.needs) && Number.isFinite(result.wants) && Number.isFinite(result.savings), 'ningún valor queda NaN');
});

test('normalizeBudgetDistribution ante un histórico totalmente irrecuperable (los tres en 0) cae al 50/30/20 por defecto', () => {
  const result = normalizeBudgetDistribution({ needs: 0, wants: 0, savings: 0 });
  assertEqual(JSON.stringify(result), JSON.stringify(DEFAULT_BUDGET_DISTRIBUTION), 'cae al default, nunca queda en 0/0/0');
});

test('normalizeBudgetDistribution es idempotente: normalizar un resultado ya normalizado no lo cambia', () => {
  const first = normalizeBudgetDistribution({ needs: 33, wants: 33, savings: 34 });
  const second = normalizeBudgetDistribution(first);
  assertEqual(JSON.stringify(first), JSON.stringify(second), 'normalizar dos veces da el mismo resultado');
});
