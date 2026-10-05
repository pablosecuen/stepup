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
