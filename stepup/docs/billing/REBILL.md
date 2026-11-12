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
