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

## M1 + M2 — Facturación / suscripciones (docs/billing/M1_ARQUITECTURA.md y M2_ARQUITECTURA.md)

    # Usar embedded-postgres 17.x (npm i embedded-postgres@17.10.0-beta.17 pg fuera del repo; NODE_PATH apunta a su node_modules).
    # Son módulos ESM (.mjs): ejecutan lib/billing/*.ts TAL CUAL contra las funciones SQL reales, por conexiones directas como service_role.
    node supabase/tests/postgres/m1_billing.mjs                     (66 comprobaciones sobre las TRES migraciones de facturación: esquema, RLS y privilegios, integridad, checkout atómico, avisos no confiables, arrendamientos, tubería completa, concurrencia, registro fiscal, devoluciones y contracargos, sondeo por suscriptor, reparación, eliminación, cambio de plan, trabajos)
    node supabase/tests/postgres/m1_billing.mjs --mutations         (rompe a propósito cada garantía de las MIGRACIONES; todas deben detectarse)
    node supabase/tests/postgres/m1_billing.mjs --lib-mutations     (rompe a propósito el procesador, el almacén y los comandos contra Postgres real)
    node supabase/tests/postgres/m2_migration_rehearsal.cjs         (ensayo BEGIN…ROLLBACK de las migraciones de facturación: cuerpos, privilegios, RLS, índices, huellas, dos propietarias, rollback reproducible; SIN db push)
    node --expose-gc supabase/tests/postgres/m2_billing_scale.mjs --subs 1000 --out docs/billing/m2-scale-metrics.json
                                                                    (1.000 cuentas con renovaciones a la misma hora, 5.000 avisos duplicados/desordenados, trabajador que muere, conciliación paginada, sondeo por suscriptor con 3 trabajadores, registro fiscal, barrido del reloj y planes de consulta; mide tiempo, consultas y memoria)
    node supabase/tests/postgres/m3_lifecycle.mjs                   (M3: ciclo de vida completo con el adaptador falso: checkout → pago → renovación con trabajador caído y con aviso perdido → rechazo → gracia → limitado → reintento; cancelación idempotente; aviso duplicado y ajeno; aislamiento)
    node supabase/tests/billing/domain_mutations.mjs                (mutaciones del dominio puro lib/billing contra la batería unitaria)
    node supabase/tests/billing/bundle_scan.mjs .next               (tras «npm run build»: navegador sin credenciales, interruptores, planes ni funciones de facturación; servidor sin valores secretos)

## R9 + R10 — Traslado desde la app móvil (docs/TRASLADO_EXPO_GO_A_WEB.md)

    # Usar embedded-postgres 17.x (npm i embedded-postgres pg fuera del repo; NODE_PATH apunta a su node_modules). Datos SINTÉTICOS (lib/backup/__fixtures__).
    node supabase/tests/postgres/transfer_rehearsal.cjs                 (traslado completo: adaptar → vista previa → confirmar → comparar CAMPO POR CAMPO origen ↔ destino → extracción de archivos del teléfono
                                                                         (el mismo código que corre en el teléfono, con un teléfono simulado) → comparar de nuevo → alterar el volcado a propósito (el comparador tiene que
                                                                         notarlo) → deshacer; 92 comprobaciones)
    node supabase/tests/postgres/transfer_rehearsal.cjs --write-golden  (además regenera lib/backup/__fixtures__/mobile-real-shape.destination.json: el volcado de referencia de las pruebas sin Postgres)
    node supabase/tests/postgres/transfer_rehearsal.cjs --before-r10    (sólo hasta R9: muestra lo que R10 cierra; termina con error A PROPÓSITO)
    node supabase/tests/postgres/transfer_rehearsal.cjs --before-r9     (la base de Production de hoy: muestra lo que R9 y R10 cierran; termina con error A PROPÓSITO)
    node supabase/tests/postgres/r9_migration_rehearsal.cjs             (R9: BEGIN…ROLLBACK, idempotencia, compatibilidad con importaciones anteriores y rollback exacto)
    node supabase/tests/postgres/r10_migration_rehearsal.cjs            (R10: ídem; además una importación hecha ANTES de R10 se puede deshacer después de aplicarla y la API no puede escribir en las tablas nuevas)
    node supabase/tests/postgres/r11_freeze_rehearsal.cjs               (R11: migración idempotente y reversible; retención resuelta —la copia permanente conserva todos los respaldos aunque la app anterior rote los 10 más nuevos, el trabajo de R4 no toca el origen—;
                                                                         cierre que exige el último respaldo, el cotejo COMPLETO y la confirmación; congelada: la app anterior no guarda respaldos y no se importa, sin afectar sesión ni escrituras de la web; reabrir)
    node supabase/tests/postgres/export_schema_rehearsal.cjs            (exportación del destino sobre el esquema ANTERIOR a R9/R10 y el nuevo: «no disponible en esta versión» sólo para las tablas nuevas; aborta ante permisos, red o tabla existente faltante; cifrado y recuperación)
    node supabase/tests/postgres/extractor_destination_rehearsal.cjs    (el extractor con el cliente real de Supabase contra un destino aislado con la forma de Supabase: prueba de un archivo, tamaño distinto, caída del servidor, «ya existe», idempotencia, ausentes, aislamiento)
    node supabase/tests/postgres/real_rehearsal.cjs <copia-origen.tfsc>  (ENSAYO CON EL RESPALDO REAL en un Postgres local aislado y descartable: importa, coteja, deshace y borra todo; informa sólo ids y cantidades)
