# Cobrar según la duración de la clase — tarifa por hora (24/11/2026)

## Causa

El importe de una clase de un alumno «por clase» era **siempre** `plan.amount`: un importe fijo por clase, sin relación con la duración. Una clase de 90 minutos con `$36.000` generaba `$36.000`
aunque esa cifra fuera el valor de una hora (el resultado correcto es `$54.000`). El modelo no distinguía «importe fijo por clase» de «tarifa por hora», así que tampoco había forma de declararlo.
La app original tiene el mismo modelo (su prueba `calendarDurationEdit.test.ts` 18/19 afirma expresamente que el importe no depende de la duración): es un importe fijo por clase por diseño.

## Qué significa la tarifa actual (y qué NO se hizo)

Todos los planes «por clase» existentes siguen siendo **importe fijo por clase**. Nada se convierte en tarifa horaria por inferencia: un plan pasa a «por hora» sólo cuando la profesora lo elige en
**Plan de cobro → Por clase → Tarifa por hora** (se guarda como `rateBasis: "hour"` dentro del propio plan; ausente = importe fijo). Los alumnos creados desde el alta rápida o el formulario de alta
nacen con importe fijo; la base se cambia en su Plan de cobro.

## Regla

`importe = tarifa por hora × duración facturable (minutos) / 60`, en centavos enteros, redondeo mitad hacia arriba al centavo. Con `$36.000/h`: 45 min `$27.000` · 60 `$36.000` · 75 `$45.000` ·
90 `$54.000` · 120 `$72.000` · 135 `$81.000`. Sobre ese valor se aplican las reglas de resultado de siempre (dictada 100 %, cancelada tarde según su política, no dictada 0).

* **Duración facturable**: la real del registro (la que la profesora confirma o corrige al registrar la clase); si no hay, la programada del propio registro o de su clase del calendario (ya con
  cualquier «Extender duración» o cambio de horario aplicado); 60 minutos sólo como último recurso. Es la misma que propone la pantalla de registro.
* Cambiar sólo la hora de inicio no cambia el importe. Cuotas mensuales y entrenamientos cubiertos por una cuota no se prorratean ni generan cargo por clase.

## Dónde vive la regla

| Capa | Archivo |
|---|---|
| Regla compartida (aritmética y duración) | `lib/payments/lesson-amount.ts` |
| Importe de la clase (base + resultado) | `computePerClassBilledAmount` en `lib/payments/adhoc-billing.ts` |
| Servidor de aplicación | `syncPerClassChargesForRegistration` en `lib/actions/lesson-registrations.ts` |
| Base de datos (valida y es la autoridad para tarifas por hora) | `sync_per_class_charge`, `lesson_hourly_amount`, `lesson_billed_amount`, `lesson_billable_minutes` — migración `20261124100000_hourly_rate_billing.sql` |
| Plan de cobro | `lib/payments/plan-form.ts`, `components/students/profile/billing-plan-card.tsx`, RPC `set_student_billing_plan` |
| Rótulos y proyección | `per-student-overview.ts` («por hora»), `lib/reports/hourly-rate.ts` (valor hora programado) |

## Tarifa congelada e historia

* El cargo de una clase por hora guarda `rate_per_hour` y `billed_minutes`. Al editar la duración de ESA clase se recalcula con SU tarifa, nunca con la vigente.
* Una clase se cobra con la tarifa vigente **en su fecha** (la auditoría de cambios de plan, `student_billing_audit`, es la historia; un cambio hecho durante el día vale para todo ese día).
  Un cambio de tarifa posterior ya no reprecia un cargo existente sin pagos.
* Nunca se modifica un cargo con pagos (parciales o saldados), ni uno generado antes de la tarifa horaria (sin tarifa congelada) de un alumno que hoy paga por hora.

## Corrección de cargos pendientes ya generados (NO se ejecuta sola)

1. La profesora declara «Tarifa por hora» en el Plan de cobro del alumno (los cargos existentes no cambian).
2. `select * from hourly_charge_review()` — **sólo lectura**. Cada cargo vigente, sin tarifa congelada, de un alumno por hora cuyo importe difiere de la regla nueva, con su categoría:
   `automatico_sin_pagos` (sin ninguna asignación y con el importe que daba la regla anterior → corregible), `con_pagos` (parcial o saldado → revisión humana), `personalizado` (importe distinto de la
   regla automática → pudo fijarlo la profesora → revisión humana).
3. Informar el alcance a la profesora **antes** de aplicar.
4. `select apply_hourly_charge_repairs(array[…ids…])` — corrige sólo los `automatico_sin_pagos`, re-verificando con el cargo bloqueado; guarda el estado anterior en `financial_repair_audit`
   (`reason = 'hourly_rate_repair'`). Idempotente.
5. `select rollback_hourly_charge_repairs(array[…ids…])` — vuelve al importe anterior mientras el cargo siga sin pagos.

## Pruebas

* `lib/payments/__tests__/lesson-amount.test.ts` (regla, ejemplos, importe fijo intacto, plan de cobro, cableado, migración aditiva) y `lib/reports/__tests__/hourly-rate.test.ts`.
* `supabase/tests/postgres/hourly_rate_billing.mjs` (Postgres real, 107 comprobaciones): diferencial TypeScript ↔ SQL, circuito completo, reintentos y carreras, tarifa congelada y por fecha, importe fijo,
  cargos con pagos, corrección/reversión, aislamiento entre cuentas, privilegios. Cada garantía de la migración se rompe a propósito (11 mutaciones) y la batería las detecta todas.
