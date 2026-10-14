# M3 — Preparación sin credenciales: resultados, variables y plan de aplicación

Rama `m1-billing` (local; sin push, sin `db push`, sin deploy, sin Vercel, sin llamadas a Mobbex). Fecha de trabajo: 14/10/2026. **No se activó nada**: `BILLING_ENABLED=false` y `BILLING_ENFORCEMENT_ENABLED=false` siguen siendo los valores por defecto.

## 1. Cambios de esta etapa

| Cambio | Detalle |
|---|---|
| Migración M2 renombrada | `20261015100000_m2_billing_ops.sql` → **`20261014120000_m2_billing_ops.sql`** (14/10, única, posterior a `20261014110000`). Actualizados el rollback, el ensayo, la batería de Postgres y M2_ARQUITECTURA. No se tocó ninguna migración ya aplicada (la última aplicada es `20261012100000`). |
| Soporte configurable | `lib/billing/support.ts`: el correo sale de `BILLING_SUPPORT_EMAIL`, validado estrictamente (sin parámetros ni encabezados inyectables). Si falta o es inválido **no se dibuja ningún enlace de correo**. Tarjeta «Ayuda y condiciones» en Facturación. |
| Textos mínimos en borrador | `lib/billing/legal.ts` + `/facturacion/condiciones` (404 con la facturación apagada): renovación, cancelación, cobro rechazado, devoluciones y disputas, privacidad del DNI/CUIT, tratamiento del pago. Todo lo que decide TeacherFlow queda `[A DEFINIR: …]` y listado en `LEGAL_PENDING`; sin razón social ni datos fiscales inventados. Aviso «Texto en revisión» hasta que `BILLING_LEGAL_REVIEWED=true`. Enlace desde la elección de plan. |
| Requisitos para encender | `checkBillingReadiness` ahora también exige `BILLING_SUPPORT_EMAIL` válido y `BILLING_LEGAL_REVIEWED=true` (sólo nombres, nunca valores). |
| Ciclo de vida completo | `supabase/tests/postgres/m3_lifecycle.mjs` (§3). |

## 2. Revisión de seguridad del diff de M1/M2 (sin hallazgos nuevos)

- `SUPABASE_SERVICE_ROLE_KEY`: se lee en un único archivo (`lib/billing/supabase-store.ts`); `readiness.ts` sólo la nombra. Las credenciales de Mobbex, en un único archivo (`providers/mobbex.ts`). Prueba estructural.
- DNI/CUIT: sólo en `customer.ts` (validación), la acción del servidor y el adaptador; no está en ninguna tabla (búsqueda textual en las 12 tablas en `m3_lifecycle`), el registro seguro (`log.ts`) sólo admite códigos cortos, y `bundle_scan` confirma que el navegador no trae credenciales ni rutas de facturación.
- Avisos: sólo POST, cuerpo ≤16 KB, respuesta uniforme, el cuerpo reduce a una pista; el dinero lo decide la consulta autenticada; los ajenos se descartan sin consultar.
- Eliminación de cuenta: cancela y confirma en el proveedor antes de borrar; sólo con el interruptor encendido.
- Interruptores: pantallas y APIs responden 404 antes de leer cuerpo, secreto o base.

## 3. Verificación local (todo con Postgres 17 real y el adaptador falso)

| Verificación | Resultado |
|---|---|
| Ensayo `BEGIN … ROLLBACK` de las **tres** migraciones sobre las migraciones reales del repositorio + 2 propietarias | todo ok: 12 tablas con RLS, 29 funciones, huellas idénticas antes/dentro/después, ningún objeto residual tras el ROLLBACK, reaplicar es idempotente, rollback reproducible |
| Batería de billing `m1_billing.mjs` | **66 de 66** |
| **Compatibilidad con la web desplegada**: baterías de Postgres de R3/R4/R5/R6.1/R8 con las 3 migraciones de billing cargadas | R3 88, R4 50, R5 68, R6.1 125, R8 26: **todas ok** (las migraciones sólo agregan objetos; las huellas de las tablas de la aplicación no cambian) |
| **Ciclo completo** `m3_lifecycle.mjs` | **13 de 13 pasos** (abajo) |
| Build de producción (webpack) + `bundle_scan` | OK; navegador limpio |
| Humo con interruptores apagados | webhook y los dos cron → 404 (GET/POST, con y sin Bearer); `/login` 200; `/ruta-inexistente` 404 |
| Typecheck, lint, suite de billing | limpios; 233 de 233 en `lib/billing` |

Ciclo de `m3_lifecycle.mjs` (reloj controlado, código de aplicación real): cuenta nueva (limitada, `subscribe`) → checkout (el documento llega al proveedor y **no** queda en ninguna tabla) → volver del proveedor **no activa** → primer pago con aviso mentiroso (gana la consulta autenticada) → aviso duplicado ×4 y aviso ajeno/malformado (sin consultar al proveedor) → renovación con el **trabajador caído** (arrendamiento vencido, se procesa una vez) → renovación con **respuesta perdida** (past_due → el sondeo la recupera) → cobro rechazado (gracia D+1..D+5 con aviso; limitado a las 00:00 de D+6, coinciden resolutor y barrido) → reintento aprobado (vuelve a acceso completo; aviso repetido sin efecto) → otra cuenta: cancelar con el proveedor caído no cambia nada, el reintento cancela una vez, repetir es idempotente, acceso hasta el fin del período, vencimiento y aviso tardío que no la revive → aislamiento (historial sin datos ajenos ni identificadores del proveedor; registro fiscal sin propietaria).

**No se pudo hacer:** el ensayo `BEGIN … RAISE EXCEPTION` contra el esquema de **Production** (el entorno bloqueó la lectura de Production: requiere autorización explícita de Joaquín) y, por no haber sesión de Supabase, el clic de los botones contra la base real ni la comprobación HTTP de las páginas privadas con billing apagado (se verifica por prueba estructural: `notFound()` antes de pedir datos).

## 4. Frontera de credenciales: qué falta y dónde conseguirlo

### 4.1 Dónde entrar (según mobbex.dev/primeros-pasos)
1. **Portal de Desarrolladores**: https://mobbex.com/devportal (con el usuario del comercio) → «+» para crear una aplicación (nombre, descripción, URL de referencia) → «Solicitar Acceso» a la Entidad con su CUIT.
2. **Consola**: https://mobbex.com/console → apartado «APP/E-Commerce» → «Autorizar» la aplicación.
3. Volver al Portal → «Gestionar» → **«Ver Credenciales»**: de ahí salen la **API Key** (`x-api-key`) y el **Access Token** (`x-access-token`).
4. Sandbox: la documentación indica probar con las credenciales del comercio **agregando `test: true`** (lo hace el adaptador con `MOBBEX_SANDBOX=true`). Las credenciales públicas de ejemplo de la documentación **no se usan**. La documentación no describe una marca visual en el panel para distinguir prueba de producción.
5. Las **4 suscripciones plantilla** (mensual, trimestral, semestral, anual; cada una con su UID) se crean con `buildCreateSubscriptionRequest` (modo sandbox) y sus UIDs se guardan en las variables de abajo. La documentación consultada no detalla si el panel también permite crearlas: confirmar con Mobbex.

### 4.2 Variables (nombres exactos; nunca en el chat ni en archivos versionados)

| Variable | Local (`.env.local`) | Preview | Production |
|---|---|---|---|
| `BILLING_ENABLED` | `true` sólo para pantallas con el falso | `true` sólo durante la prueba en sandbox | **`false`** hasta la activación |
| `BILLING_ENFORCEMENT_ENABLED` | `false` | `false` | **`false`** (M3 de activación, aparte) |
| `BILLING_PROVIDER` | `fake` (el falso se ignora en Production) | `mobbex` | `mobbex` |
| `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN` (sensibles) | vacías | credenciales de la cuenta, con `MOBBEX_SANDBOX=true` | credenciales de producción, sólo al activar |
| `MOBBEX_SANDBOX` | — | `true` | `false` |
| `MOBBEX_SUBSCRIPTION_UID_TF_MONTHLY_ARS_V1`, `…_QUARTERLY_ARS_V1`, `…_SEMIANNUAL_ARS_V1`, `…_ANNUAL_ARS_V1` | — | UIDs de las plantillas de prueba | UIDs de las plantillas reales |
| `MOBBEX_WEBHOOK_URL` | — | URL de avisos de Preview (al crear plantillas) | `https://teacherflowapp.com/api/billing/webhooks/mobbex` |
| `MOBBEX_VALIDATED_CAPABILITIES` | vacía | `changePlan,paymentMethodUpdate` **sólo** tras validarlas en sandbox | igual, sólo si se validaron |
| `SUPABASE_SERVICE_ROLE_KEY` (sensible, sólo servidor) | proyecto local/de pruebas | del proyecto de Supabase que use ese Preview | la de Production |
| `CRON_SECRET` (≥32 caracteres, sensible) | opcional | sí | sí |
| `BILLING_SUPPORT_EMAIL` | cualquiera de prueba | sí | sí (lo define TeacherFlow) |
| `BILLING_LEGAL_REVIEWED` | — | vacía | `true` sólo tras la revisión legal |
| `BILLING_GRANDFATHER_CUTOFF`, `BILLING_STATE_COOKIE_SECRET` | — | — | sólo para el control de acceso (activación), no ahora |

**Decisión que necesito de Joaquín:** el Preview que pruebe el sandbox escribiría sus suscripciones de prueba en el proyecto de Supabase al que apunte. Si Preview comparte la base de Production, esas filas de prueba quedarían en Production (aisladas por RLS pero reales en la base). Recomendado: un proyecto o rama de Supabase aparte para el sandbox, o limpiar las filas de prueba al terminar.

### 4.3 URL de avisos
`https://teacherflowapp.com/api/billing/webhooks/mobbex` (Production). En sandbox, la URL del despliegue de Preview (sin la protección de despliegue de Vercel en esa ruta, o los avisos no llegan y quedan cubiertos por el sondeo). La documentación consultada **no describe dónde se registra el aviso** (por cuenta o por pedido): el adaptador lo envía en cada suscripción plantilla (`MOBBEX_WEBHOOK_URL`); confirmarlo con Mobbex.

### 4.4 Qué pedirle por escrito a soporte de Mobbex
(a) ¿firma, secreto o lista de IP oficial para los avisos?; (b) forma del contenido de `executions` y valor de estado de un suscriptor suspendido; (c) «mover suscriptor»: agenda y cobro inmediato; (d) ¿la URL de control permite cambiar el medio de pago?; (e) unicidad de `reference` de suscriptor ante re-suscripción; (f) código o aviso de **contracargo**; (g) límites de tasa de la API; (h) ¿el formulario alojado puede capturar DNI/CUIT con vinculación segura a la propietaria?; (i) tarjetas de prueba oficiales y cómo simular rechazo/devolución; (j) dónde se registra la URL de avisos (cuenta o pedido) y si se puede crear la suscripción plantilla desde el panel.

## 5. Qué parte de M3 queda bloqueada por Mobbex

Bloqueado (necesita credenciales): crear las plantillas, la prueba extremo a extremo en sandbox, validar `changePlan` y cambio de medio de pago, confirmar el formato real de `executions`, firma/IP de avisos y contracargos. **No bloqueado y ya hecho:** todo el dominio, la base, el receptor, los trabajadores, las pantallas, los textos en borrador y el ciclo completo con el adaptador falso.

## 6. Plan final de aplicación de migraciones y rollback (para cuando se autorice)

Orden de los archivos: `20261014100000_m1_billing_core.sql`, `20261014110000_m1_billing_functions.sql`, `20261014120000_m2_billing_ops.sql` (todos posteriores a la última migración aplicada, `20261012100000`).

1. Checkout limpio de la rama (sin `.next` ni `supabase/.temp` versionados), `git status` limpio.
2. `supabase migration list --linked`: la remota termina en `20261012100000`; `db push --dry-run`: salen **sólo** estas tres; comparar el SHA-256 de cada archivo con el del commit.
3. Línea base de sólo lectura (conteo y huella por tabla de la aplicación).
4. Ensayo `BEGIN … RAISE EXCEPTION` contra Production con `supabase db query --linked -f` (revertido; verifica 12 tablas con RLS, 29 funciones, huellas).
5. **Un único** `db push --yes`.
6. Línea base posterior: las tablas de la aplicación idénticas (la excepción conocida es `active_sessions.last_seen_at`); 12 tablas `billing_*` con RLS; `billing_settings` con el corte de cuentas existentes; todas las cuentas existentes `grandfathered`.
7. La web desplegada no necesita un nuevo deploy para esto: no usa ninguna de las tablas nuevas. El código nuevo sólo se despliega después, desde checkout limpio y con ambos interruptores apagados.

**Rollback** (`supabase/repairs/m1_billing_rollback.sql`, ejecutado con `db query --linked -f`): elimina todo lo de facturación y **conserva** `billing_fiscal_records` (borrarlo es una sentencia explícita y aparte). Es idempotente y reaplicar deja las mismas huellas. Sólo es seguro antes de que existan cobros reales; después de eso el camino es apagar los interruptores, no revertir la base. No se debe editar ninguna migración ya aplicada: cualquier corrección posterior va en una migración nueva idempotente.
