# Cierre de pendientes (11/11/2026, segunda entrega)

Complementa `CALENDARIO_MOVIL_20261111.md` y `COBROS_ESTADISTICAS_20261111.md`.

## 1. Contadores que quedaban en cero

**Causa (reproducida en Edge real con el componente anterior):** `AnimatedNumber` dejaba el texto visible en «$ 0» apenas montaba y esperaba un `IntersectionObserver` con `threshold: .5` y `rootMargin: "-64px 0px -12% 0px"`. Un contador pegado al borde inferior de una página (menos de ~12 % de la ventana, o con un píxel visible) nunca cumplía esa condición: se veía «$ 0» mientras el texto accesible decía «$ 1.234,50». Además, sin `IntersectionObserver` el componente fallaba y, con movimiento reducido, mutaba a mano un nodo que React ya no controlaba.

**Arreglo (componente compartido, no cada cifra):** `lib/ui/count-animation.ts` (puro, con entorno inyectable) + `components/ui/animated-number.tsx`.

- El valor final es SIEMPRE el estado por defecto; la animación sólo reemplaza el texto mientras corre. Nunca se prepara un 0 en un contador que aún no se ve.
- Arranca cuando se ve **un píxel** del contador (chequeo inmediato por geometría + observador con `threshold: 0` y sin margen).
- Sin `IntersectionObserver`, con movimiento reducido (también si se activa a mitad de camino), con valor inválido (`NaN`) o sin cambio de valor: valor final inmediato.
- Una animación nueva cancela la anterior (nunca dos a la vez). Al cambiar de período parte de lo que se estaba mostrando y termina exacto en el valor nuevo.
- El visible y el accesible salen del mismo `formats[kind](value)`; los importes se interpolan en centavos y el último cuadro es exactamente el valor recibido.
- Sin `setTimeout` ni esperas artificiales; React es el único dueño del texto (se eliminó `textContent =`).
- `components/finance/finance-motion.tsx` (barras y arcos de los gráficos) tenía el mismo defecto de borde (35 % + margen): barras aplastadas hasta que se veían. Misma regla: un píxel alcanza; sin observador se cancelan las animaciones pausadas y quedan completas.

**Usos:** sólo Finanzas — KPIs del Resumen financiero (generado, cobrado, pendiente, vencido, deuda de meses anteriores, alumnos que pagaron, alumnos con deuda), «Cobrado en el período» y las tres partes del plan 50/30/20, y los dos ahorros teóricos de la proyección anual. **Inicio no usa este contador** (muestra texto fijo; si falla la carga dice «Sin datos», nunca 0).

**Pruebas:** `lib/ui/__tests__/count-animation.test.ts` (11): caso del borde inferior con el entorno real del navegador simulado, umbral 0 sin margen, sin observador, movimiento reducido (y a mitad de camino), interrupción sin superposición, centavos exactos, HTML del componente real (visible = accesible) y que el componente ya no contiene los mecanismos antiguos. **Navegador:** mismo recorrido contra el componente anterior y el nuevo (Edge, 390×800, contador con 3 px visibles): anterior = «$ 0» durante todo el muestreo; nuevo = 367 → 733 → 953 → … → «$ 1.234,50» en ≈ 0,9 s; cambio de período continúa desde lo mostrado y termina en «$ 98.765,43»; con movimiento reducido, valor final al cargar.

## 3. Doble pantalla / segunda recarga — revisión (sin causa demostrada)

No se reprodujo en Chromium. Revisado contra el recorrido Inicio → Cobros → Resumen financiero:

- Una sola `main`, una sola barra inferior y una sola cabecera en cada instante (registro de `startViewTransition` + conteo por cuadro); ninguna transición abortada; ninguna recarga completa.
- Lo único que muestra dos pantallas a la vez **por diseño** es el cruce de `tf-content-swap`: la saliente se desvanece en 120 ms mientras la entrante aparece en 220 ms.
- Fuentes de una segunda carga **visible** encontradas en el código: `ChargeGenerationTrigger` (Inicio, Cobros, Recordatorios, pestaña Cobros) llama a `router.refresh()` si la acción crea cargos (`created > 0`): ocurre sólo cuando hay cobros por generar (cambio de mes, alumno o acuerdo nuevo) y vuelve a pedir los datos de la pantalla recién abierta.
- Next 16.3.8 (`app-router-instance.js`): una navegación **descarta** la Server Action pendiente (no queda esperándola), así que esa acción no retrasa la navegación.
- No se cambió CSS ni el motor de transición: no hay evidencia de que sea la causa.

**Evidencia que falta:** la grabación del video con marcas de tiempo o una corrida autenticada con datos reales (sesión QA) en iPhone/Safari, que es donde se vio. Sin eso no se atribuye causa ni se declara corregido.

## 5. JSON null en los otros puntos de entrada (migración `20261111110000_plan_json_null_entrypoints.sql`)

- **Origen del jsonb 'null':** el adaptador de la app (`billingPlan: profile.billingPlan ?? null`) manda JSON null; `_import_stage` lo toma con `->` y `_import_apply_students` lo insertaba tal cual.
- **Importación:** `normalize_imported_billing_plan` — NULL de SQL y JSON null → NULL de SQL; objeto → intacto; texto, número, arreglo o booleano → se rechaza con mensaje claro y la importación entera se revierte.
- **Reconciliación:** `apply_financial_reconciliation` resolvía el plan con `coalesce`; con jsonb 'null' o un escalar sus comprobaciones «El importe no coincide con el plan vigente» y «El cargo no está cubierto por el plan individual» **fallaban abiertas** (reproducido en Postgres real: aceptó un importe equivocado, un plan escalar y la anulación «por cobertura mensual» de un cargo por clase). Ahora usa `effective_student_billing_plan` (la misma resolución validada).
- No se reescribe ninguna fila ni migración ya aplicada. Prueba: `supabase/tests/postgres/plan_json_null_entrypoints.cjs` (24 comprobaciones; con `--before` muestra el defecto: 12/19).
