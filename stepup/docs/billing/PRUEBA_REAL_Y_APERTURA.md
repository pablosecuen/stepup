# Prueba real de pago, ensayo en sandbox y apertura al público

Estado al 25/11/2026: contratación **limitada al piloto** (`BILLING_PILOT_OWNER_IDS` = la cuenta QA), control de acceso **apagado**, Rebill **productivo** (0 pagos, 0 suscripciones).

## A. Ensayo en el SANDBOX (sin dinero real) — cierra lo que la documentación no resuelve

Qué se puede y qué no (documentación oficial de Rebill + sondeo contra el sandbox real):

| Situación | ¿Se puede en sandbox? | Cómo |
|---|---|---|
| Primer cobro | Con una **persona** en el sitio de pago y una tarjeta de prueba. Rebill no permite crear pagos por API sin datos de tarjeta (acceso a tarjeta cruda apagado) | tarjeta de abajo |
| Renovación | Sí | `scripts/rebill-sandbox-rehearsal.mjs advance <sub> --yes` (`POST /v3/subscriptions/:id/sandbox/advance`) |
| Renovación rechazada y reintentos | Sí: la tarjeta de abajo aprueba el 1.º cobro y rechaza las renovaciones; cada `advance` ejecuta el siguiente reintento; tras el 4.º queda `paused/defaulted` (en sandbox los reintentos son de 2, 2, 3 y 3 **horas**) | ídem |
| Pausa y reanudación con fecha | Sí | `pause` / `resume <sub> AAAA-MM-DD` |
| Devolución | Probable (el endpoint existe: `POST /v3/refunds/:id`); si el sandbox la acepta no está documentado: se prueba | `refund <pay> --yes` |
| Webhook de prueba | Sí (`POST /v3/webhooks/:id/test`), pero llega firmado con el secreto del webhook **del sandbox**, no con el de producción | no aporta a producción |
| **Contracargo** | **No documentado** cómo simularlo | queda sin probar: se cubre sólo con simulador |

Pasos (los hace Joaquín el pago; el resto lo hace Claude):
1. Claude corre `node scripts/rebill-sandbox-rehearsal.mjs link --env-file <sandbox>`: imprime una dirección de pago del **sandbox** con una referencia nueva (`tf_ref`).
2. Joaquín abre esa dirección y paga con la Visa de prueba de Argentina **que aprueba el primer cobro y rechaza las renovaciones**: `4573 0152 9630 7413`, vencimiento `01/2099`, CVV `123`, cualquier nombre (es una tarjeta de prueba oficial de Rebill; no cobra dinero real). Cierra la pestaña sin volver.
3. Claude corre `status` y `rebill-verify.mjs` (sólo lectura) y comprueba: dónde llega `tf_ref` (pago y/o suscripción), el orden real de `sort: updated_at`, la paginación; luego `advance` (renovación rechazada → reintentos → `defaulted`), `pause`/`resume` con fecha (la próxima fecha de cobro no cambia de forma incorrecta) y `refund`. Todo con el simulador de TeacherFlow apuntando al sandbox real en un entorno aislado (Postgres local), nunca contra Production.

## B. La ÚNICA prueba real (plan mensual, $25.900)

**Quién hace qué:** la titular ingresa personalmente la tarjeta y confirma el pago. Claude no cobra, cancela, reanuda ni devuelve nada: cada una de esas acciones necesita una autorización explícita aparte.

Antes (Claude, sólo lectura): `node scripts/rebill-verify.mjs --env-file <productiva>` debe mostrar 0 pagos y 0 suscripciones, el webhook activo con los 4 eventos, y la cuenta QA en el piloto sin intentos de pago abiertos.

Pasos de Joaquín:
1. Iniciar sesión con la cuenta QA (la del piloto). Facturación → Planes → **Mensual ($25.900 todos los meses)** → «Continuar al pago seguro».
2. En el sitio de Rebill verificar que dice **25.900,00 ARS / mes**, cargar la tarjeta y pagar **una sola vez**.
3. **No volver a TeacherFlow**: cerrar la pestaña apenas aparezca el comprobante (así se prueba que la activación no depende de la página de resultado). No repetir el pago ni hacer doble clic.
4. Avisar «pagué».

Después (Claude, sólo lectura):
- `rebill-verify.mjs`: 1 pago aprobado de 25.900 ARS con `tf_ref`, 1 suscripción activa del plan mensual con próximo cobro a un mes, sin duplicados.
- Consulta SQL (que el mismo script imprime, con la huella de `tf_ref`): 1 intento de pago, 1 cuenta vinculada, 1 ejecución aprobada, 1 período, avisos recibidos y procesados, 0 revisiones abiertas.
- Registros de Vercel: aviso recibido y procesado (o recuperado por el cron `reconcile`), sin errores.
- La cuenta QA figura activa en Facturación **sin** haber visitado la página de resultado.

**Qué NO se hace solo:** cancelar, reanudar, cambiar de plan o **devolver**. Sobre devolver: la documentación de Rebill sólo dice que el contracargo tiene una tarifa no reembolsable y que las comisiones originales de procesamiento no se devuelven en un contracargo; **no documenta** qué pasa con las comisiones en una devolución normal (el desglose de tesorería de un pago muestra una `refund_fee`). Por eso **no se asume** que devolver recupere las comisiones: antes de devolver, consultar a Rebill y mirar el desglose del pago. Si se decide probar cancelar/reanudar/devolver en producción, será una autorización explícita por cada acción.

## C. Apertura al público (sólo después de A, B y de las decisiones pendientes)

1. Textos: revisión legal efectiva (si se hizo, recién ahí `BILLING_LEGAL_REVIEWED=true`), decisiones de devoluciones y aviso de cambio de precio incorporadas (`TEXTOS_PARA_REVISION_20261125.md`).
2. Quitar `BILLING_PILOT_OWNER_IDS` de Vercel Production y **volver a desplegar** (`/planes` y Términos se prerenderizan y leen la variable al compilar): el botón pasa de «Crear cuenta» a «Contratar» y los Términos dejan de decir «en preparación».
3. Verificar en Production sin pagar: `/planes` con «Contratar» en los 4 planes, `/contratar?plan=…` sin sesión pide ingresar y vuelve al plan, los importes y equivalencias, y `rebill-verify.mjs` sin cambios (0 cobros nuevos).
4. Vigilar 24 h: registros `[billing]`, cron `process`/`reconcile` sin errores, avisos recibidos.
5. **Reversión:** volver a poner `BILLING_PILOT_OWNER_IDS` con el id de la cuenta QA y redeploy (la contratación vuelve a quedar sólo para el piloto; lo ya cobrado sigue procesándose).

## D. Activar el control de acceso (después de C o antes, según se decida)

Ver `CONTROL_DE_ACCESO.md` §7. Con las 5 cuentas existentes `grandfathered`, activarlo sólo afecta a cuentas nuevas.

## E. Limitaciones reales del sandbox (confirmadas con la documentación oficial y con la API, 25/11/2026)

- **No hay forma de crear un cobro con tarjeta sólo por API**, ni siquiera en sandbox: `POST /v3/checkout` con `card` da 403 (`raw_card_data_not_enabled`), con `cardId` exige una tarjeta ya guardada, y con `cardTokenId` exige el SDK en un navegador con una clave **pública** `pk_` del sandbox (la organización de sandbox no expone ninguna por API). Tampoco está documentado `POST /v3/subscriptions` ni un endpoint para crear un `manual_first_subscription_payment`.
- **Camino sin tarjeta:** PIX/Boleto (moneda BRL, con datos de facturación) se aprueban solos en sandbox, pero los planes de TeacherFlow son en ARS, no hay un ejemplo documentado de una suscripción por PIX y **los pagos que no son con tarjeta no se devuelven por API**. No sirve para ensayar TeacherFlow.
- **Por eso el primer cobro del sandbox lo hace una persona** con una tarjeta de prueba en el sitio de pago del sandbox (no cobra dinero real). Todo lo demás sale de `scripts/rebill-sandbox-rehearsal.mjs`.
- **Cambio de tarjeta:** `POST /v3/subscriptions/:id/card/update-link` (sin cuerpo) devuelve `{ url, shortUrl, token }` con `url` en `pay.rebill.com` (vence a los 7 días); también existe `POST /v3/subscriptions/:id/request-card-change` (lo manda por correo). Que funcione en sandbox **no está documentado**. Al completarse llega `subscription.updated` con `cardUpdated: true` y sin cambio de estado (la integración lo trata sólo como señal: paso 22 del ciclo). `PATCH` con `cardId` no es fiable (la documentación se contradice). La función está **apagada** hasta validarla.
- **Devolución:** `POST /v3/refunds/:id`, sólo pagos con tarjeta en `approved` o `partially_refunded`; si el sandbox la acepta no está documentado. El evento puede aparecer como `payment.updated` con estado `refunded` (la documentación nombra también `payment.updated.refunded`: confirmar qué llega).
- **Webhook:** el sandbox no puede entregar a una dirección local. La entrega, la firma y el formato se confirman con la **única prueba real** (el webhook de producción recibe el aviso). El procesamiento de avisos duplicados, tardíos y fuera de orden sí está probado con Postgres real.
- **Contracargo:** no documentado cómo simularlo.
- Con un pago de sandbox hecho por una persona se pueden ejecutar, en orden: `status` → `rebill-verify.mjs` (dónde llega `tf_ref`, orden y paginación) → `advance` (renovación rechazada → reintentos en horas → `defaulted`) → `pause` → `resume <sub> AAAA-MM-DD` → `refund`.

