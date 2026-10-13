# M1 — Decisiones cerradas

Respuesta de Joaquín a las 11 decisiones abiertas de la revisión de M1. M1 **no se rehizo**: estas reglas se aplican como correcciones y como trabajo de M2. Esta tabla es la fuente: si algo contradice a este documento, gana este documento.

| # | Decisión | Dónde se implementa |
|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` **sólo en servidor** y **sólo** mediante el módulo de facturación y las funciones `billing_*`. Nunca en cliente, logs ni previews. Sin consultas genéricas fuera de ese módulo. | `lib/billing/supabase-store.ts` es el único lector de la clave; `billing-structure.test.ts` y `bundle_scan.mjs` lo hacen cumplir (la clave no está en ningún paquete del navegador ni en logs). |
| 2 | Los avisos de Mobbex son **señales no confiables**: tamaño estricto, esquema mínimo, límite de frecuencia, deduplicación, respuesta rápida; **ningún estado se decide con el cuerpo recibido**; todo cambio se confirma consultando la API autenticada; un sondeo periódico recupera los avisos perdidos. Queda **por consultar por escrito a Mobbex** si ofrece firma, secreto o lista de IP oficial. | M2: `lib/billing/webhook-ingest.ts`, `app/api/billing/webhooks/mobbex/route.ts`, `lib/billing/processor.ts`, sondeo por suscriptor. Ver `M2_ARQUITECTURA.md`. |
| 3 | **DNI/CUIT**: se pide sólo al empezar la suscripción, viaja de servidor a Mobbex, **no se persiste**, no entra en logs, eventos, analítica ni mensajes de error, se limpia de memoria y del formulario al terminar, con aviso de privacidad claro. Si el sandbox demuestra que el formulario alojado de Mobbex puede capturarlo con vinculación segura a la propietaria, se prefiere ese método. | M2: formulario de `/facturacion/planes` y acción `startCheckoutAction`. |
| 4 | **Estado desconocido**: cuenta existente o `grandfathered` → acceso completo con aviso interno seguro; cuenta anteriormente activa ante una falla propia → tolerancia acotada (72 h) y conciliación prioritaria; cuenta nueva sin pago verificado → modo limitado; **nunca** se activa por redirect, parámetro del cliente ni aviso sin conciliar. | **Corregido en M1**: `lib/billing/access.ts`, `lib/billing/last-known.ts` (comprobante firmado), `lib/billing/readiness.ts`. Pruebas: `access-unknown.test.ts` + 17 mutaciones nuevas. |
| 5 | **Eliminación**: cancelar primero en Mobbex, confirmar, después borrar datos operativos; conservar **10 años** un registro fiscal mínimo y seudonimizado (referencia de operación, fecha, importe, moneda, estado, comprobante, huella de conciliación). No se conserva perfil pedagógico, alumnos, DNI/CUIT, tarjeta ni cargas útiles. ARCA exige conservar documentación y libros al menos 10 años. | M2: migración `…m2_billing_ops.sql` (`billing_fiscal_records`) y `lib/billing/account-deletion.ts`. |
| 6 | Una cuenta `grandfathered` que se suscribe voluntariamente **pierde** esa condición y luego sigue las reglas normales. | **Corregido en M1**: `ledger.ts` (`reduceSnapshot` la quita con el primer período pagado; abrir un checkout y abandonarlo **no** la quita). |
| 7 | **Cambio de plan**: efectivo en el próximo período; sin prorrateo ni crédito; validar en sandbox el «mover suscriptor» antes de habilitarlo. | M2: el adaptador real devuelve `unsupported` para `changePlan` hasta validar en sandbox; el adaptador falso lo implementa completo. |
| 8 | **Gracia**: vencimiento en D; gracia de D+1 a D+5 inclusive; modo limitado desde las 00:00 de D+6 en la zona del dominio (Argentina). | Ya en M1 (`periods.ts`, `GRACE_DAYS = 5`); sin cambios. |
| 9 | **Reembolsos y contracargos**: nunca se borran datos; contracargo conciliado → modo limitado inmediato y revisión; reembolso total confirmado → no extiende el período y se aplica el fin de acceso que corresponde; parcial o ambiguo → revisión manual; auditoría sin datos sensibles. | M2: `ledger.ts` (hechos `refunded` y `chargeback`), `reconcile.ts`, tabla de revisiones. |
| 10 | **Modo limitado**: puede iniciar sesión, ver todos sus datos, exportarlos, ver facturación, actualizar el medio de pago, cancelar y contactar a soporte; no puede crear, editar, importar ni ejecutar operaciones de negocio. | **Corregido en M1**: `AccessCapabilities.contactSupport`. |
| 11 | **Cancelación «proveedor primero»**: operación idempotente; si Mobbex confirma y la base falla, el barrido repara la base; nunca «base primero» si existe riesgo de volver a cobrar. | Ya en M1 (`commands.ts`); M2 agrega la reparación por barrido y la prueba. |

## Qué cambió en el código por estas decisiones (commit «cierre de decisiones de M1»)

* `access.ts`: variantes del estado desconocido (`state_unavailable_*`), `internalNotice`, `reconcilePriority`, `OWN_FAILURE_TOLERANCE_MS = 72 h`, `contactSupport`.
  Se eliminó el motivo `billing_state_unavailable`, que daba acceso completo a **cualquier** estado desconocido.
* `last-known.ts`: comprobante firmado (HMAC-SHA-256) de la última verificación del servidor. Único modo de saber que una cuenta «estaba activa» cuando la base propia no responde; el navegador sólo lo transporta y no puede fabricarlo ni extenderlo.
* `readiness.ts`: lista de requisitos para encender los interruptores (sólo nombres, nunca valores). Un corte de cuentas existentes faltante es un requisito del control de acceso.
* `ledger.ts`: la cuenta existente pierde `grandfathered` con su primer período pagado.

## Supuestos que tomé y que conviene confirmar

* **Tolerancia de 72 h**: la decisión dice «acotada» sin número. Se eligió cubrir un fin de semana completo. Se cambia en una sola constante.
* **Cuenta sin fila y sin corte configurado** se trata como existente (no se castiga a una cuenta real por una configuración faltante). Por eso `BILLING_GRANDFATHER_CUTOFF` es requisito obligatorio del control de acceso.
