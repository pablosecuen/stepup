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

    # R6 — importaciones grandes (usar embedded-postgres 17.x: la misma versión mayor que Production)
    node supabase/tests/postgres/r6_import.cjs                  (154+ comprobaciones: límites ±1, vacía/mínima/normal/máxima, duplicados, referencias, concurrencia, reintento, errores/timeouts/cortes, deshacer, cuotas, purga)
    node supabase/tests/postgres/r6_import.cjs --mutations     (17 mutaciones que rompen a propósito cada garantía; todas deben detectarse)
    OLD_MIGRATIONS_DIR=<migraciones anteriores a R6> node supabase/tests/postgres/r6_differential.cjs     (mismos datos en la versión anterior y la nueva: mismo resultado)
    node supabase/tests/postgres/r6_migration_rehearsal.cjs     (ensayo BEGIN…ROLLBACK de las migraciones R6, huellas, idempotencia, compatibilidad con lo creado antes y rollback)
    node supabase/tests/postgres/r6_import_scale.cjs --sizes 100,1000,5000,10000 --label nuevo      (medición: tiempo, consultas, memoria, lock; MIGRATIONS_DIR=<anteriores> para medir «antes»)
    OLD_MIGRATIONS_DIR=<migraciones anteriores a R6> node supabase/tests/postgres/r6_culprits.cjs   (qué parte exacta crecía de forma cuadrática: ablación y micro-pruebas)
    node --expose-gc supabase/tests/postgres/r6_web_validation_bench.cjs                            (costo de la validación de la web)

    # R6.1 — corrección funcional de la importación (dependencias dentro de la misma copia, presupuesto 50/30/20, niveles duplicados)
    node supabase/tests/postgres/r61_import.cjs                 (batería: cadena acuerdo → serie → clase → registro → cobro sobre cuenta vacía, varias cadenas, referencias faltantes y su cascada, niveles repetidos, presupuesto válido/inválido/parcial/repetido, dos propietarias, cuotas, purga, error a mitad, límite de 7.500 y escala)
    ONLY=chain,levels,budget node supabase/tests/postgres/r61_import.cjs     (sólo esas secciones: static, chain, independent, mixed, levels, budget, owners, concurrent, stale, undoblocked, quotas, midfailure, scale)
    node supabase/tests/postgres/r61_import.cjs --mutations     (25 mutaciones: orden de fases, mapa de ids, suma 100, niveles repetidos, aislamiento, idempotencia, costo por elemento; todas deben detectarse)
    node supabase/tests/postgres/r61_migration_rehearsal.cjs    (ensayo BEGIN…ROLLBACK de la migración R6.1 sobre el estado de Production con R6, idempotencia, compatibilidad y rollback)
    R61_COMPARE=1 OLD_MIGRATIONS_DIR=<migraciones hasta R6> node supabase/tests/postgres/r6_differential.cjs     (R6 contra R6.1: sólo cambian los tres defectos corregidos)
    node supabase/tests/postgres/r6_import_scale.cjs --atmax --linked --label r61      (mide el máximo de 7.500 unidades con la cadena completa dentro de la copia)

`r3_quotas.cjs`: topes (−1 / exacto / +1), rollback completo, idempotencia (misma clave en el tope), dos conexiones por la última unidad,
varias conexiones por pocas unidades, dos propietarias en paralelo, ON CONFLICT DO NOTHING, categorías con filtro, límites por hora,
tamaño de fila, acciones costosas por ventana, `anon`/sin sesión y configuración sin acceso desde la API.
