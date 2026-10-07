# Pruebas SQL en Postgres REAL (varias conexiones simultáneas)

A diferencia de PGlite (una única conexión), estas pruebas arrancan un PostgreSQL de verdad (`embedded-postgres`, binarios que se instalan
FUERA del repo) y cargan TODAS las migraciones reales con stubs mínimos de Supabase (roles, `auth.uid()`, `storage`, y las tablas de la app
móvil `active_sessions`/`cloud_backups`). Sirven para lo que PGlite no puede probar: locks, concurrencia y carreras entre conexiones.

    mkdir %TEMP%\epg && cd %TEMP%\epg && npm i embedded-postgres pg
    set NODE_PATH=%TEMP%\epg\node_modules
    node supabase/tests/postgres/r3_quotas.cjs                 (88 comprobaciones)
    node supabase/tests/postgres/r3_quotas.cjs --mutations     (rompe cada control a propósito; todas deben detectarse)
    node supabase/tests/postgres/r3_migration_rehearsal.cjs    (ensayo BEGIN…ROLLBACK de las migraciones R3, huellas, idempotencia y rollback)

`r3_quotas.cjs`: topes (−1 / exacto / +1), rollback completo, idempotencia (misma clave en el tope), dos conexiones por la última unidad,
varias conexiones por pocas unidades, dos propietarias en paralelo, ON CONFLICT DO NOTHING, categorías con filtro, límites por hora,
tamaño de fila, acciones costosas por ventana, `anon`/sin sesión y configuración sin acceso desde la API.
