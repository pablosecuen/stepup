# Pruebas SQL en Postgres REAL (varias conexiones simultáneas)

A diferencia de PGlite (una única conexión), estas pruebas arrancan un PostgreSQL de verdad (`embedded-postgres`, binarios que se instalan
FUERA del repo) y cargan TODAS las migraciones reales con stubs mínimos de Supabase (roles, `auth.uid()`, `storage`, y las tablas de la app
móvil `active_sessions`/`cloud_backups`). Sirven para lo que PGlite no puede probar: locks, concurrencia y carreras entre conexiones.

    mkdir %TEMP%\epg && cd %TEMP%\epg && npm i embedded-postgres pg
    set NODE_PATH=%TEMP%\epg\node_modules
    node supabase/tests/postgres/r3_quotas.cjs                 (88 comprobaciones)
    node supabase/tests/postgres/r3_quotas.cjs --mutations     (rompe cada control a propósito; todas deben detectarse)
    node supabase/tests/postgres/r3_migration_rehearsal.cjs    (ensayo BEGIN…ROLLBACK de las migraciones R3, huellas, idempotencia y rollback)
    node supabase/tests/postgres/r4_retention.cjs              (50 comprobaciones de la purga de importaciones vencidas: gracia, locks, concurrencia, privilegios)
    node supabase/tests/postgres/r4_retention.cjs --mutations  (rompe cada control de la purga a propósito; todas deben detectarse)
    node supabase/tests/postgres/r4_migration_rehearsal.cjs    (ensayo BEGIN…ROLLBACK de las migraciones R4, huellas, idempotencia, web anterior y rollback)
    node supabase/tests/postgres/r5_hygiene.cjs                (batería de comportamiento de la aplicación ANTES/DESPUÉS de R5 con dos propietarias + catálogo)
    node supabase/tests/postgres/r5_hygiene.cjs --mutations    (rompe cada control de R5 a propósito; todas deben detectarse)

`r3_quotas.cjs`: topes (−1 / exacto / +1), rollback completo, idempotencia (misma clave en el tope), dos conexiones por la última unidad,
varias conexiones por pocas unidades, dos propietarias en paralelo, ON CONFLICT DO NOTHING, categorías con filtro, límites por hora,
tamaño de fila, acciones costosas por ventana, `anon`/sin sesión y configuración sin acceso desde la API.
