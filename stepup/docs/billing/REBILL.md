# Rebill — suscripción de la profesora a TeacherFlow

Rebill (docs.rebill.com) reemplaza a Mobbex como proveedor de cobro de la **suscripción de la profesora a TeacherFlow**. Nada de esto toca los cobros que la profesora registra a sus alumnos (otra tabla, otro módulo, otro dinero).
Mobbex queda sólo como adaptador histórico explícito (`BILLING_PROVIDER=mobbex`) y en las filas ya registradas; el adaptador falso existe sólo fuera de Production y para pruebas.

## 1. Cómo funciona

```
/planes (pública) ──Contratar──▶ /contratar?plan=<código>  (recuerda sólo el código del plan en una cookie corta)
        ▶ /facturacion/planes?plan=…  (privada: sin sesión → /login o /crear-cuenta y vuelve al plan elegido)
        ▶ «Antes de pagar»: plan, total ahora y renovación automática  ▶ «Continuar al pago seguro»
        ▶ startCheckoutAction → dirección del payment link de ESE plan en pay.rebill.com
             + tf_ref=<referencia opaca tfs_… de la cuenta> + email de la sesión (sólo prellena)
        ▶ Rebill carga la tarjeta, cobra el período completo y crea la suscripción recurrente
        ▶ vuelve a /facturacion/resultado (IGNORA la URL: sólo muestra el estado conciliado)
```

* **Nunca** se activa nada por volver del sitio de pago ni por un aviso. El acceso lo da un cobro **aprobado** que la consulta autenticada (`GET /v3/payments/:id`) confirma, con el importe y el plan del catálogo (no los del aviso).
* **Vínculo del cobro con la cuenta:** el primer pago trae `tf_ref` en su `metadata` (token opaco de 128 bits, sin datos personales). Al conciliar ese cobro aprobado se vincula el `sub_…` de Rebill a la cuenta (`billing_bind_subscribers`); las renovaciones se resuelven por ese uid. Si el aviso de la suscripción llega antes que el cobro, se consulta la suscripción y se adopta por la referencia de sus pagos.
* **Un aviso que sólo trae el id del pago** (p. ej. una devolución) se asigna por los cobros ya conciliados.
* **Primer intento sin suscripción** (rechazado, o aprobado antes de que exista la suscripción): el plan se infiere por el importe sólo si trae nuestra referencia y coincide con exactamente un plan de los que esa cuenta puede cobrar hoy.
* **Dos suscripciones para la misma cuenta** (dos pestañas / dos pagos): queda vinculada la última y la otra se **pausa** en Rebill; queda una revisión abierta (probable devolución de uno de los pagos).
* **Cancelar la renovación = pausar** la suscripción en Rebill (`PATCH status: paused`); el acceso pagado se conserva hasta el fin del período. **Reanudar** manda `nextChargeDate` = fin del período pagado (12:00 de Argentina; si ya pasó, el día siguiente). La baja `cancelled` de Rebill es terminal y no se usa.
* **Eliminar la cuenta** pausa la suscripción **antes** de borrar nada; si la cuenta pagó hace instantes y el suscriptor todavía no estaba vinculado, primero se concilia a pedido; si Rebill no responde, la cuenta no se elimina (podría quedar una suscripción cobrando sin dueña).
* **Cambio de plan** y **actualización del medio de pago** NO se ofrecen hasta que se declaren validados en sandbox (`REBILL_VALIDATED_CAPABILITIES`). Rebill aplica el cambio de plan al instante y sin prorrateo; el dominio lo programa para el próximo período: no se habilita hasta comprobar el comportamiento real.

## 2. Avisos (webhook) y recuperación

Ruta: `POST /api/billing/webhooks/rebill`. Se verifica `x-rebill-signature` (HMAC-SHA256 hexadecimal del **cuerpo crudo**, clave = secreto completo `whsec_…`) **antes** de guardar nada (401 y sin registro si falla). Aun firmado, el aviso es una señal: se reduce a identificadores, se guarda con clave de deduplicación y se concilia con la consulta autenticada. No hay marca de tiempo en la firma: por eso un aviso repetido o reenviado nunca activa ni extiende nada por sí solo.

| Camino | Qué cubre |
|---|---|
| Aviso → `after()` inmediato (la respuesta ya salió) | acreditación en segundos |
| Cron `process` (cada 5 min) | avisos que quedaron en cola, sondeo por suscriptor |
| Cron `reconcile` (cada 15 min) | reloj (vencimientos/gracia), **barrido global de pagos** (recupera cobros sin aviso y con el navegador cerrado), retención |
| Volver a `/facturacion/resultado` | conciliación a pedido de los pagos recientes (acotada: 1 consulta cada 20 s por instancia) |

Eventos que importan: `payment.created`, `payment.updated`, `subscription.created`, `subscription.updated`. Los demás se reconocen e ignoran.

## 3. Ambientes (nunca se mezclan)

Rebill tiene organizaciones separadas para sandbox y producción (los identificadores de prueba llevan `test_`). El adaptador se **cierra** (ninguna llamada de red) si falta la clave, si la clave es pública (`pk_`), si el ambiente no está declarado o si los ids de plan no corresponden al ambiente. En `production` sólo cuentan operaciones reales: una `test_…` se ignora aunque llegue firmada.

Variables (sólo servidor, en la configuración segura de Vercel; ver `.env.example`):

| Variable | Qué es |
|---|---|
| `REBILL_API_KEY` | clave **secreta** `sk_…` de la organización del ambiente |
| `REBILL_ENVIRONMENT` | `sandbox` o `production` |
| `REBILL_WEBHOOK_SECRET` | secreto de firma `whsec_…` de esa organización |
| `REBILL_PLAN_ID_TF_{MONTHLY,QUARTERLY,SEMIANNUAL,ANNUAL}_ARS_V2` | id `pln_…` de cada plan (identificadores, no secretos) |
| `REBILL_CHECKOUT_URL_TF_{…}_ARS_V2` | dirección `https://pay.rebill.com/…` del payment link de cada plan |
| `REBILL_VALIDATED_CAPABILITIES` | `changePlan`, `paymentMethodUpdate` cuando se validen |
| `BILLING_ENABLED` / `BILLING_ENFORCEMENT_ENABLED` | interruptores (apagados por defecto) |
| `CRON_SECRET` | secreto de los trabajos programados (32+ caracteres) |
| `SUPABASE_SERVICE_ROLE_KEY` | la usa únicamente `lib/billing/supabase-store.ts` |

## 4. Qué hay que crear en Rebill (por ambiente)

1. **Cuatro planes** en ARS, cobro automático, **sin prueba gratuita, sin cupones ni descuentos**, importes del catálogo vigente (`lib/billing/plans.ts`, versión `v2`): Mensual $ 25.900 cada 1 mes; Trimestral $ 69.900 cada 3 meses; Semestral $ 131.400 cada 6 meses; Anual $ 238.800 cada 12 meses. Confirmar en el panel moneda, periodicidad y total.
2. **Un payment link por plan** (con ese plan), con la URL de retorno **aprobado** apuntando a `https://teacherflowapp.com/facturacion/resultado`. Los parámetros extra de la dirección (`tf_ref`) quedan en el `metadata` del pago.
3. **Un webhook** a `https://teacherflowapp.com/api/billing/webhooks/rebill` con los eventos `payment.created`, `payment.updated`, `subscription.created`, `subscription.updated`; copiar su secreto `whsec_…`.
4. Cargar las variables de la sección 3 en Vercel (sandbox en Preview/QA, producción sólo en Production). Los ids y direcciones de sandbox **no** sirven en producción: se vuelven a crear.
5. Revisar en el panel qué correos envía Rebill al cliente (comprobantes/avisos): TeacherFlow no envía correos de cobro propios, así que no hay duplicados; el texto legal lo informa.

### 4 bis. Aprovisionamiento con `scripts/rebill-provision.mjs`

Reemplaza los pasos 1–3 de arriba por una corrida repetible. (El adaptador citaba `provision.mjs` y ese archivo no existía en el repositorio: el script se recreó el 19/11/2026 con ese nombre y con las garantías de abajo.)

```
node scripts/rebill-provision.mjs check                       # sólo lectura
node scripts/rebill-provision.mjs provision                   # simulacro
node scripts/rebill-provision.mjs provision --apply           # crea lo que falte (en producción exige además --yes-production)
```

* La clave secreta `sk_…` se lee de `REBILL_API_KEY` o de `.env.rebill.local` (ignorado por git). Nunca por argumentos ni por el chat. Una clave por organización: sandbox y producción se corren por separado.
* Busca antes de crear (por `metadata.tfCode`); si no puede listar lo existente **no crea nada**; ante un plan con otro precio, una prueba gratuita o un link que no vuelve a `/facturacion/resultado`, se detiene (nunca edita un precio).
* Crea los planes en ARS con el **total del período** (25.900 / 69.900 / 131.400 / 238.800 cada 1 / 3 / 6 / 12 meses), sin prueba gratuita ni repeticiones; un payment link por plan (sólo tarjeta) con retorno aprobado y rechazado a `/facturacion/resultado`; y el webhook con los cuatro eventos.
* Imprime los ids y direcciones (no secretos). El secreto de firma del webhook, que Rebill muestra una sola vez, queda en `.env.rebill.secrets.local` (permisos 600) y nunca se imprime: se carga en Vercel como `REBILL_WEBHOOK_SECRET` (sensible) y se borra el archivo.
* `check` también prueba contra la API real los cuerpos de búsqueda que usa la integración (ver «Qué dice la documentación oficial» abajo): hay que correrlo con la clave real antes de encender nada.

### 4 ter. Qué dice la documentación oficial (leída el 19/11/2026) y qué NO está confirmado

Confirmado por la documentación: encabezado `x-api-key`; clave `sk_` en servidor (los endpoints de links, pagos, suscripciones y webhooks rechazan `pk_`); firma `x-rebill-signature` = HMAC-SHA256 hexadecimal del cuerpo crudo con el secreto completo `whsec_…` (sin marca de tiempo); eventos `payment.created` / `payment.updated` / `subscription.created` / `subscription.updated`; estados de pago `pending`, `approved`, `rejected`, `refunded`, `partially_refunded`, `cancelled`, `chargeback`; `PATCH /v3/subscriptions/:id` acepta `active`, `paused` y `cancelled` y `nextChargeDate` (hoy o después); el payment link devuelve su `url` (`https://pay.rebill.com/{alias}/{pl_…}`).

**La referencia `tf_ref`:** la página del checkout alojado documenta que «cualquier parámetro que no esté en la lista reservada se guarda en el `metadata` del pago» y llega en `GET /v3/payments/:id` y en los avisos de ese cobro. `tf_ref` no es reservado, así que **debería** llegar. **No está documentado** que se copie a la suscripción ni al cliente: por eso la integración vincula con el `metadata` del PAGO y, recién después, adopta el `sub_…`. Sigue siendo una hipótesis hasta comprobarla con un cobro real en el sandbox (`check` no puede probarla).

**No confirmado todavía (se prueba con la clave real):**
* Los nombres de los campos del cuerpo de `POST /v3/payments/search` y `POST /v3/subscriptions/search` no están impresos en la documentación y Rebill responde 400 ante propiedades desconocidas. La integración usa `limit/offset/sortBy/sortOrder/subscriptionId`; `check` lo verifica. Si falla, se rompe el barrido global de pagos (la recuperación sin aviso).
* La ruta para leer la organización y la de buscar planes/links/webhooks no están impresas; el script prueba rutas candidatas e informa cuál responde.
* El campo `environment` de la organización vale `sandbox` o `productive`; la integración usa `REBILL_ENVIRONMENT=sandbox|production` (valores propios, no los de Rebill).
* Si los ids de plan del sandbox llevan el prefijo `test_` (el adaptador se cierra si el prefijo no coincide con el ambiente). La documentación sólo lo afirma de las organizaciones.
* **Recuperación de avisos fallidos:** Rebill reintenta (5 min, 1 h, 1 día) y marca el fallo en su panel, pero **no documenta ninguna API para listar ni reenviar avisos**. La recuperación no depende de eso: el cron `reconcile` barre los pagos con la consulta autenticada.

## 5. Para pasar a producción

Rebill habilita producción cuando termina su proceso comercial. Entonces: nuevas claves, nuevos planes/links/webhook en la organización de producción (nada se reutiliza de sandbox), `REBILL_ENVIRONMENT=production`, aplicar el checklist de la matriz de pruebas con una compra real **hecha por la titular** (el importe exacto del plan elegido) y recién después encender `BILLING_ENABLED` al público. No se abre el cobro si el circuito depende de respuestas simuladas.

## 6. Decisiones comerciales que no se inventaron

* Política y plazo de devoluciones (`LEGAL_PENDING`); una devolución total anula el período, una parcial va a revisión manual.
* Reintentos de cobro fallido: hoy rige la política existente (5 días de gracia y luego modo limitado). Rebill puede reintentar por su cuenta (`retrying`): el estado de la suscripción en Rebill y el de TeacherFlow se concilian, pero la cantidad/espaciado de reintentos es configuración de Rebill.
* Razón social, CUIT y domicilio del responsable, y revisión legal final (`BILLING_LEGAL_REVIEWED`).

## 7. Pruebas

* `lib/billing/__tests__/rebill-adapter.test.ts`: firma, avisos, estados, configuración cerrada, checkout, pausa/reanudación, capacidades, barrido.
* `supabase/tests/postgres/rebill_lifecycle.mjs`: ciclo completo con Postgres real y un Rebill simulado (19 pasos: checkout sin duplicados, volver sin pago, firma inválida, pendiente/rechazado/aprobado, duplicados, renovación, devolución por id de pago, avisos tardíos, cancelar/reanudar con caída, recuperación con el navegador cerrado, adopción por aviso de suscripción, dos suscripciones, operaciones de prueba en producción, eliminación de cuenta, aislamiento y ausencia de secretos en la base).
* `supabase/tests/postgres/rebill_migration_rehearsal.cjs`: ensayo BEGIN…ROLLBACK, idempotencia, privilegios y rollback (`supabase/repairs/rebill_provider_rollback.sql`).
* Sandbox real: ver la matriz de QA del informe de entrega (cuatro planes; aprobado/pendiente/rechazado/abandonado; volver y recargar; doble clic y dos pestañas; avisos repetidos/tardíos/desordenados; primer cobro y renovación; cancelar y conservar el período; caída de red; dos cuentas; móvil y escritorio).

## 8. Notas de operación

* `/planes` (pública) se prerenderiza en el build y lee `BILLING_ENABLED` en ese momento: al encender o apagar la facturación hay que **volver a desplegar** para que el botón pase de «Crear cuenta» a «Contratar».
* Los dos cron (`process` cada 5 min, `reconcile` cada 15 min) están declarados en `vercel.json` y son inertes mientras `BILLING_ENABLED` no sea `true` (404 aunque el secreto sea correcto); con la facturación encendida exigen `CRON_SECRET`.
* El estado «Pago rechazado» de la pantalla de resultado sólo aparece cuando hay un rechazo conciliado en las últimas 24 h y la cuenta todavía no tiene suscripción; un pago pendiente se muestra como «confirmando» (sin registrar nada) y uno abandonado no deja ningún rastro.

## 9. Estado de las incertidumbres (25/11/2026)

| Tema | Estado | Evidencia |
|---|---|---|
| Cuerpo de la búsqueda de pagos | **Corregido**: `pagination: { limit, offset, sort: "updated_at", order }` | Sondeo contra el sandbox real: `pagination.sort` se acepta, `sortBy` da 400. La documentación dice que SIN `sort` ordena por `created_at`: un pago viejo devuelto/contracargado no subiría y el barrido lo perdería |
| Orden efectivo por `updated_at` | Pendiente de confirmar con un pago real del sandbox (el simulador ya lo respeta) | `rebill_lifecycle.mjs` paso 19; ensayo del §A de `PRUEBA_REAL_Y_APERTURA.md` |
| `paused` + `defaulted` | **Estado identificado** (`defaulted`): fin del cobro del proveedor → la cuenta expira, limitada, y puede volver a suscribirse. NO es una cancelación pedida | Rebill: reintentos 2/2/3/3 días y luego `paused/defaulted`; paso 20 del ciclo |
| Dónde llega `tf_ref` | Documentado en el `metadata` del PAGO; copia a la suscripción: no documentado | Se confirma con el primer pago (sandbox y real); la integración ya no depende de eso |
| Webhook (firma, formato, duplicados, tardíos, fuera de orden) | Coincide con la documentación; cubierto con simulador y Postgres real | pasos 3, 6, 12, 16, 17 del ciclo |
| Activación sin volver del checkout | Cubierta con simulador (aviso y barrido); real: la prueba única, cerrando la pestaña | paso 9 del ciclo |
| Pausa/reanudación y próxima fecha | `nextChargeDate` exigido al reanudar; no prorratea | pasos 7–8 del ciclo; sandbox: `resume` |
| Renovación, fallo, devolución | Simulador y Postgres real; sandbox: `advance`, `refund` tras un primer pago | ensayo §A |
| Contracargo | **No documentado cómo simularlo**; sólo simulador | pasos del ciclo (devolución/contracargo) |
| Comisiones en una devolución | **No documentado** | no se asume su reintegro |
