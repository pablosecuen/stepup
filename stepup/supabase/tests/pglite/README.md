# Pruebas SQL en Postgres en memoria (PGlite)

No requieren Docker ni tocan ninguna base remota. Cargan TODAS las migraciones reales (35 de 38: las 3 que fallan dependen de
`storage` y `active_sessions`, que existen fuera de este repo) con stubs mínimos de Supabase (`auth.uid()`, roles).

PGlite NO es dependencia del proyecto: se instala fuera del repo, por ejemplo

    mkdir %TEMP%\pglite && cd %TEMP%\pglite && npm i @electric-sql/pglite
    set NODE_PATH=%TEMP%\pglite\node_modules
    node supabase/tests/pglite/student_creation_scenarios.cjs
    node supabase/tests/pglite/student_creation_mutations.cjs   (cada mutación de la función debe ser "detectada")

`student_creation_scenarios.cjs`: alta de alumno idempotente por (owner, operation_id) — claim sólo al enviar, recarga,
doble envío, respuesta perdida, pestaña duplicada/independiente, rollback sin claims huérfanos, aislamiento entre profesoras.
Limitación: PGlite tiene una única conexión, así que el "doble envío simultáneo" se serializa; la garantía real de
concurrencia es el advisory lock por profesora + el índice único (owner_id, operation_id).

## R2 — lecturas completas, saldos abiertos e índices

`r2_open_charge_balances.cjs` (`--mutations` rompe la función a propósito y exige que cada rotura sea detectada): dos propietarias
con más de 1.700 cargos cada una; `list_open_charge_balances()` frente a un cálculo independiente en centavos, aislamiento A/B (también
sin RLS: la función filtra por `auth.uid()` por sí misma), sólo lectura (huellas), atributos de seguridad (INVOKER, `search_path` vacío,
sin parámetros, EXECUTE sólo `authenticated`) y equivalencia con `buildCollectionsCenterEntries` (tarjetas y orden).

`r2_migration_rehearsal.cjs`: ensayo único BEGIN … ROLLBACK de las dos migraciones R2 sobre el esquema real con datos; huellas de todas
las tablas antes/después, nada eliminado, reaplicación idempotente, consultas del web anterior intactas.
