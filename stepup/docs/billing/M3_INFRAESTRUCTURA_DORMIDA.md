# M3 — Infraestructura dormida (14/10/2026)

**M3 infraestructura dormida: migraciones aplicadas y código desplegado con billing y enforcement apagados. Sin credenciales, llamadas ni cobros de Mobbex. Pendiente de sandbox externo.**

## Qué se hizo
1. **Ensayo en Production** (una transacción que termina siempre en `RAISE EXCEPTION`, sin `COMMIT`; usuarios sintéticos `m3-rehearsal-*@example.invalid`): se aplicaron las tres migraciones dentro de la transacción y se ejecutaron 76 comprobaciones (estructura, privilegios, RLS, aislamiento entre propietarias con los roles `authenticated`/`anon`/`service_role`, grandfathered, 4 planes y un ajuste, y **huellas de todo lo que no es de facturación idénticas antes y después**). 76 de 76 al final. Los dos primeros intentos fallaron por errores del propio script de ensayo (un `min(uuid)`, un permiso sobre una tabla temporal y un instante de fixture), todos dentro de la transacción y revertidos.
2. **Residuos tras el rollback:** 0 usuarios sintéticos, 0 tablas, funciones, triggers ni privilegios de billing; línea base **idéntica** (26 huellas/campos y 46 tablas de datos).
3. **Aplicación:** `migration list` (última remota `20261012100000`, pendientes sólo las tres) → SHA-256 de los archivos = SHA-256 de los commits → `db push --dry-run` (sólo las tres) → un único `db push --yes`, sin `--include-all` ni `--force`.
4. **Verificación posterior (sólo lectura + una transacción revertida):** 12 tablas `billing_*` con RLS; 29 funciones (todas ejecutables por `service_role`, ninguna por `anon` ni `authenticated`; `SECURITY DEFINER` sólo `billing_ensure_account`); `anon` sin ningún privilegio; `authenticated` sin escrituras; aislamiento A/B correcto; **5 de 5 cuentas existentes `grandfathered`**; 4 planes; 1 ajuste con corte fijado; 0 filas en avisos, ejecuciones, períodos, registro fiscal, intentos y revisiones; 3 secuencias (propias de las tablas de billing); 2 trabajos de cron previos intactos; ninguna tabla previa cambió (huellas de datos, columnas, funciones, políticas, privilegios, RLS, índices, triggers y restricciones idénticas).
5. **Código:** commits `4338fb0`, `c305d0d`, `35b3b99` y `ce3fa78` publicados con push fast-forward sin force (`7a63254..ce3fa78` en `teacherflow-web`). Despliegue desde un checkout limpio de `ce3fa78` (sin `supabase/.temp` ni `.next`).

## Estado de Production
- Deployment `teacherflow-ocqvw71cl-teacherflow.vercel.app` (`dpl_7zEvZQGL6qBLftLMeXZM2iKzTH3g`): **Ready**, aliases `teacherflowapp.com`, `teacherflow-web.vercel.app` y `teacherflow-web-teacherflow.vercel.app`.
- Variables de Production: **ninguna de billing** (`BILLING_*`, `MOBBEX_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`). Con la facturación apagada nada las necesita; si faltan, todo falla cerrado (404 / `billing_unavailable`).
- Humo HTTP: webhook y cron → **404** (GET/POST); `/facturacion`, `/facturacion/planes`, `/facturacion/resultado` y `/facturacion/condiciones` sin sesión → 307 a `/login` (como cualquier ruta privada) y, con sesión y los interruptores apagados, `notFound()` por código y prueba estructural; `/login` 200; el tercer alias está detrás de la autenticación de Vercel (como antes).
- Escaneo del HTML y de los 11 bundles públicos servidos: 0 coincidencias de Mobbex, claves de servicio, secretos de cron, interruptores, rutas de API de billing ni planes; ningún JWT con rol de servicio.
- Logs del deployment nuevo: 40 solicitudes (todas de la verificación), **0 respuestas 5xx**, sin registros de runtime de errores. Ninguna llamada a Mobbex es posible (adaptador cerrado: sin credenciales y con ambos interruptores apagados).

## Desviaciones y límites
- No se probó con una sesión autenticada real (no se usan credenciales reales): el menú sin «Facturación», las páginas privadas y la conservación del acceso completo se verifican por pruebas estructurales y de comportamiento, no por navegación autenticada en Production.
- El escaneo de bundles de Production cubre las páginas públicas; el escaneo del build completo (`bundle_scan.mjs`) se hizo sobre el mismo árbol en local. El build de Vercel usa Turbopack, el local de verificación usó webpack.
- El commit de documentación no se despliega (sólo agrega este archivo): Production corre `ce3fa78`.

## Pendiente (externo; no se hizo)
Credenciales y UIDs sandbox de Mobbex, consulta escrita a soporte, `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` en Vercel (cuando se encienda), `vercel.json` de cron y regla de límite de tasa para el receptor, `BILLING_SUPPORT_EMAIL`, revisión legal (`BILLING_LEGAL_REVIEWED`), decisión de la base para Preview, prueba de extremo a extremo en sandbox y, para el control de acceso, `BILLING_GRANDFATHER_CUTOFF` y `BILLING_STATE_COOKIE_SECRET`. Detalle en `M3_PREPARACION.md` §4.
