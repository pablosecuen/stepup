# M2 — Integración segura en sandbox: arquitectura, rutas y operación

Estado: **implementado y verificado en local, sin push, sin `db push`, sin deploy y sin configuración de Vercel**. `BILLING_ENABLED=false` y `BILLING_ENFORCEMENT_ENABLED=false` por defecto: con ambos apagados la aplicación actual no cambia (ver §9). Parte de [`M1_ARQUITECTURA.md`](./M1_ARQUITECTURA.md) y de las [decisiones cerradas](./M1_DECISIONES.md).

## Índice

1. Qué hay y qué cambió respecto de M1
2. Rutas
3. Receptor de avisos
4. Trabajadores y cron
5. Pantallas
6. Mobbex y sandbox: qué se validó y qué no
7. Devoluciones, contracargos y eliminación de cuenta
8. Ensayo SQL (BEGIN … ROLLBACK)
9. Con los interruptores apagados no cambia nada
10. Amenazas nuevas de M2
11. Escala
12. Verificación y resultados
13. Requisitos externos pendientes (lista exacta)
14. Qué NO hace M2

---

## 1. Qué hay y qué cambió respecto de M1

| Área | Archivos | Qué hace |
|---|---|---|
| Receptor de avisos | `app/api/billing/webhooks/mobbex/route.ts`, `lib/billing/webhook-ingest.ts`, `rate-limit.ts`, `http.ts` | POST único; tipo, tamaño y frecuencia acotados; respuesta uniforme; guarda sólo una *pista* mínima |
| Trabajos | `app/api/billing/cron/process`, `cron/reconcile`, `lib/billing/jobs.ts`, `processor.ts` | cola de avisos por lotes, **sondeo por suscriptor**, barrido del reloj, barrido global, retención, métricas sin datos personales |
| Pantallas | `app/(app)/facturacion/{page,planes,resultado}`, `components/billing/*`, `lib/billing/view.ts` | planes, suscripción actual, historial, estados, cancelación, medio de pago, cambio de plan |
| Acciones | `lib/actions/billing.ts` | checkout, cancelar, reactivar, cambiar plan, medio de pago; la cuenta sale de la sesión |
| Base | `supabase/migrations/20261014120000_m2_billing_ops.sql` | sondeo, devoluciones/contracargos, registro fiscal, historial, operación |
| Adaptador | `providers/fake.ts` (completo), `providers/mobbex.ts` (cerrado, sólo lo documentado) | el falso implementa TODO el puerto; el real no sale a la red sin credenciales |
| Eliminación | `lib/billing/account-deletion.ts` + paso opcional en `lib/account/delete-account-flow.ts` | cancelar y **confirmar** en el proveedor antes de borrar nada |

Cambios de **modelo** (todos probados contra Postgres real):

* Los avisos dejaron de «verificarse»: son **señales no confiables** (decisión 2). Se reducen a identificadores (pago, ejecución, suscriptor) y el estado sale **siempre** de una consulta autenticada.
* El proveedor tiene un nuevo método `getSubscriber` (sondeo por suscriptor) y `capabilities` (qué está validado de punta a punta).
* Resultados de un cobro: `approved`, `rejected`, `refunded` (devolución **total**) y `chargeback`. Nuevos disparadores de estado: `payment_voided` y `chargeback_confirmed`.
* `provider_plan_code`: la suscripción (plantilla) del proveedor a la que pertenece el suscriptor existe desde que se lo crea, aunque todavía no haya pagado. Corrige un hueco de M1: cancelar a alguien que había completado el checkout pero aún no pagaba no llegaba a cancelarlo en el proveedor.
* El checkout guarda el **enlace** del proveedor (HTTPS) y reutiliza el intento: doble clic, dos pestañas o volver atrás devuelven el mismo enlace sin crear un segundo suscriptor. Cambiar de plan antes de pagar cancela primero al suscriptor anterior (nunca dos suscriptores con medio de pago). Al completar un intento se guarda el suscriptor **nuevo** (en M1 se ignoraba al re-suscribirse tras cancelar, y la cancelación posterior apuntaba al viejo).
* La deduplicación de avisos ya no es eterna: mientras el aviso anterior sigue pendiente (o llegó hace menos de 60 s) un repetido se descarta; ya procesado, un aviso nuevo del mismo pago vuelve a encolar (por ejemplo, una devolución posterior a la aprobación).

## 2. Rutas

| Ruta | Método | Acceso | Con facturación apagada |
|---|---|---|---|
| `/facturacion` | GET | sesión (proxy + layout) | **404** |
| `/facturacion/planes` | GET | sesión | **404** |
| `/facturacion/resultado` | GET | sesión | **404** |
| `/api/billing/webhooks/mobbex` | POST (todos los demás: 405) | público, sin confianza en el cuerpo | **404** para cualquier método |
| `/api/billing/cron/process` | GET/POST | `Authorization: Bearer <CRON_SECRET>` | **404** (aunque el secreto sea correcto) |
| `/api/billing/cron/reconcile` | GET/POST | ídem | **404** |

Acciones (Server Actions, `lib/actions/billing.ts`): `startCheckoutAction`, `cancelSubscriptionAction`, `reactivateSubscriptionAction`, `changePlanAction`, `updatePaymentMethodAction`, `requestConfirmationAction`. Ninguna recibe cuenta, precio, período, moneda ni estado del navegador (una prueba estructural lo impide): sólo un **código de plan**. Límite por cuenta de 8 acciones por minuto (primera barrera por instancia).

`/facturacion/resultado` **ignora por completo** la URL de retorno (no lee parámetros): sólo muestra el estado guardado y pide un sondeo prioritario del suscriptor. Volver del proveedor nunca activa nada.

## 3. Receptor de avisos

Orden de las defensas (fijado por una prueba que lee el código): interruptor → método → límite de frecuencia → `Content-Type` → tamaño declarado → lectura con tope → análisis mínimo → guardado.

* **POST solamente** (405 con `Allow: POST`); `Content-Type` `application/x-www-form-urlencoded` o `application/json` (415 si no).
* **Cuerpo ≤ 16 KB**: 413 por tamaño declarado *y* por tamaño real (el lector corta apenas lo supera; mentir con `Content-Length` no sirve; sin `Content-Length` tampoco).
* **Límite de frecuencia**: 120 por minuto por cliente y 1.500 globales por instancia (429 con `Retry-After`); clave = hash corto del primer salto de `x-forwarded-for`, nunca la IP en claro; memoria acotada. Honestidad: es la *primera* barrera, por instancia; la defensa que no depende de ella está aguas abajo (abajo) y la robusta es una regla de red de la plataforma (§13).
* **Esquema mínimo**: `type` conocido, `data` objeto, y para ejecuciones `payment.id` + al menos una identidad de suscriptor; ids con `[A-Za-z0-9_.:~-]{1,128}`; formularios con tope de campos/profundidad y sin claves de prototipo. Lo que no cierra → 400. Un tipo desconocido se reconoce (200) y se ignora.
* **Nada del cuerpo decide estado**: se guardan sólo `{ pago, ejecución, uid del suscriptor, referencia }` más el tipo y un hash. Ni estado, ni importe, ni plan, ni fechas, ni datos personales. Un aviso falso que diga «aprobado» solo produce una consulta autenticada posterior.
* **Respuesta uniforme**: todo aviso bien formado recibe `200 {"ok":true}`, exista o no el suscriptor y esté repetido o no. Los desconocidos se descartan **en el procesamiento sin consultar al proveedor** (un atacante no puede forzar consultas con identificadores inventados; las anotaciones de avisos ajenos son *una por hora*, no una por aviso).
* **Respuesta rápida**: una sola escritura por aviso; el trabajo pesado es diferido.
* Una base caída responde 503 (el proveedor reintenta; el sondeo recupera igual).

## 4. Trabajadores y cron

```
 aviso ──► recepción (pista) ──► cola ──► process: reclamo con arrendamiento (SKIP LOCKED)
                                          │  resolver propietarias en 1 consulta (referencia o uid)
                                          │  descartar sin consultar a los ajenos
                                          │  consulta autenticada UNA vez por pago y lote
                                          └► reconciliar → recalcular → escribir TODO en 1 transacción (control de versión)
 sondeo por suscriptor (agenda propia): reclamo con arrendamiento → 1 consulta al proveedor por suscriptor
                                          → cobros perdidos, reparación de cancelaciones, reprogramación (backoff, 8 fallas → revisión)
 reconcile: reloj (vencimientos y fin de gracia) · barrido global del proveedor (si lo admite) · retención · estadísticas
```

* **Lotes acotados**: 500 avisos, 200 suscriptores, 500 cuentas por página; tiempo máximo por invocación (45 s) con parada limpia.
* **Arrendamientos recuperables**: si un trabajador muere, vence su arrendamiento y el lote vuelve (nada perdido, nada activado dos veces).
* **Idempotencia**: por evento (clave de la pista), por ejecución (clave única proveedor+ejecución) y por referencia (propietaria resuelta contra *nuestra* base).
* **Backoff y revisión**: avisos con espera exponencial y máximo de intentos (después, `dead` + anomalía; se pueden reencolar con `billing_requeue_dead_events`); sondeos con espera exponencial acotada a 6 h y, tras 8 fallas seguidas, **una** revisión abierta.
* **Sondeo por suscriptor** (`poll-policy.ts`): `pendiente` 2 h · `en demora` 1 h · `gracia` 6 h · `limitada` 24 h · `activa` 7 días (6 h en la ventana de 48 h antes de renovar) · `cancelada/terminada` 7 días hasta que el proveedor confirme que no cobra. Dispersión determinista de ±10 % por cuenta: las renovaciones concentradas no se sondean todas en el mismo segundo. Los suscriptores nuevos abandonados (sin intento de pago en 14 días) salen del sondeo.
* **Cero consultas por suscripción en bucles**: cada lote hace una cantidad fija de consultas (reclamar, cuentas, cobros, escribir, reprogramar). La única llamada *por suscriptor* es la consulta al proveedor (externa) — medida en §11.
* **Reparación** (decisión 11): si el proveedor ya no cobra (suspendido o terminado) y la base no lo sabe porque falló *después* de confirmarse allá, el sondeo la repara. Al revés (la base dice «cancelada» y el proveedor sigue cobrando) se vuelve a suspender y queda registrado: nunca se arriesga un cobro a quien canceló.
* **Métricas** (`jobs.ts`): sólo contadores y duraciones; una prueba busca identificadores, correos y pagos en la salida.
* **Cron**: ejemplo en [`vercel-cron.example.json`](./vercel-cron.example.json) (**no** es `vercel.json`: no se configura nada de Vercel en M2). Hobby sólo admite cron diario; con Pro se puede correr cada 5 minutos. La frecuencia sólo cambia la demora: todo es idempotente.

## 5. Pantallas

Construidas con el sistema visual del rediseño (tarjetas, insignias con texto, avisos con ícono, botones de 44 px, formularios, diálogos), sin tocar ningún componente existente. «Facturación» aparece **sólo** en el menú de cuenta y sólo con el interruptor encendido.

* **Planes** (`/facturacion/planes`): los cuatro planes —**$ 24.900** mensual, **$ 69.900** cada 3 meses, **$ 133.900** cada 6 meses, **$ 249.000** anual— con el equivalente por mes y el **ahorro frente al mensual** calculado en centavos enteros ($ 4.800, $ 15.500 y $ 49.800). No se muestra el neto de Mobbex ni la comisión (una prueba lo impide). Explica renovación automática, duración, ahorro, cancelación, acceso hasta el fin del período, 5 días de gracia y qué pasa con un pago fallido.
* **DNI/CUIT**: campo temporal, sin autocompletar, sin atributo `name`, sin almacenamiento del navegador; aviso de privacidad visible; se valida la forma (7–8 u 11 dígitos) y **ningún error repite lo escrito**; se borra del estado de la pantalla antes de salir hacia el sitio de pago. El correo lo pone la sesión, nunca el formulario. El servidor lo envía a Mobbex y no lo guarda ni lo registra (una prueba recorre todas las tablas, el registro fiscal y la salida de consola buscando el documento y el nombre).
* **Suscripción actual** (`/facturacion`): una tarjeta por estado con **texto** (nunca sólo color): `Activa`, `Confirmando pago`, `Renovando`, `Pago rechazado` (gracia: hasta el D+5 inclusive), `Acceso limitado`, `Se cancela al final del período`, `Cancelada`, `Finalizada`, `Sin suscripción`, `Acceso sin cargo` y `No disponible`; aviso de contracargo; cambio de plan programado (sin prorrateo); historial de períodos y cobros (con *Devuelto*, *Contracargo* y *Anulado*); reglas «Cómo funciona».
* **Acciones**: sólo aparece lo que funciona. *Cambiar de plan* y *Actualizar medio de pago* dependen de `capabilities` del adaptador (el falso las tiene; Mobbex las activa recién cuando se declaran validadas en sandbox). *Cancelar* pide confirmación y dice hasta cuándo conserva el acceso y que no se borra nada.
* **Resultado** (`/facturacion/resultado`): se actualiza sola cada 20 s durante 5 minutos; explica que la suscripción se activa únicamente cuando el pago queda confirmado.
* Los estados de ejemplo para revisión visual (`?escenario=`) sólo existen en el servidor de desarrollo local con el adaptador falso (`demoScenariosAllowed`); en cualquier otro entorno se ignoran.
* Capturas a 1440, 390 y 320 px: [`screenshots/`](./screenshots/).

## 6. Mobbex y sandbox: qué se validó y qué no

**Credenciales sandbox: NO hay.** Por lo tanto el adaptador de Mobbex **permanece cerrado** (sin `MOBBEX_API_KEY` y `MOBBEX_ACCESS_TOKEN` cada método devuelve `not_configured` *antes* de armar un pedido), las pantallas usan el adaptador falso (sólo fuera de Production) y **ningún pedido sale a Mobbex**. No se usaron las credenciales públicas de ejemplo de la documentación.

Verificado contra la documentación oficial (`mobbex.dev`, consultada 13/oct/2026):

| Tema | Documentado | Qué hace el adaptador |
|---|---|---|
| Encabezados | `x-api-key`, `x-access-token` | sí; sólo servidor |
| Crear suscriptor | `POST /p/subscriptions/{id}/subscriber` con `customer.{email,name,identification}`, `startDate` ≥ mañana, `reference`, `expiresAt` | sí (`expiresAt` = 24 h del enlace) |
| Suspender / reactivar | `POST …/action/suspend` / `…/action/activate` | sí (cancelar = suspender) |
| Consultar suscriptor | `GET …/subscriber/{sid}` → `status` (`active`, `finished`), `executions`, `url` (control) | sólo se interpretan las formas **mostradas**: otros valores de `status` son `unknown` y `executions` con contenido es *ilegible* (no significa «sin cobros») |
| Consultar un pago | `POST /2.0/transactions/status` | sí (fuente de verdad del dinero) |
| Estados | 200, 299–303 aprobado · 400–419, 500, 604 rechazado · **602 devuelta (total) · 605 parcialmente devuelta · 601 y 610 canceladas (alcance no definido: ambiguas)** · 600 cancelación en proceso (no final) | tabla en `mobbex-normalize.ts` |
| Avisos | `application/x-www-form-urlencoded`; **sin firma ni encabezado de autenticación documentados** | señales no confiables (decisión 2) |

**No documentado** (no se inventó; queda cerrado o apagado): firma/secreto/lista de IP de los avisos · la forma del contenido de `executions` y el valor de estado de un suscriptor suspendido · el comportamiento exacto de «mover suscriptor» (agenda y cobro inmediato) · si la URL de control permite cambiar el medio de pago · unicidad de `reference` ante una re-suscripción · cualquier código de **contracargo** · límites de tasa de la API.

Consecuencias: `changePlan` y `getPaymentMethodUpdateUrl` están implementados según la documentación pero **apagados** (`capabilities` en falso hasta `MOBBEX_VALIDATED_CAPABILITIES`); el listado global de operaciones es `unsupported` y el **sondeo por suscriptor** es la red de seguridad (sólo recupera cobros cuando se valide el formato de `executions`; mientras tanto los cobros entran por el aviso + la consulta de pago).

Con credenciales sandbox, el plan de prueba (sin crear operaciones reales ni imprimir secretos): crear las 4 suscripciones plantilla, crear un suscriptor `test: true`, consultar su estado y ejecuciones, suspender/reactivar, tarjetas de prueba para aprobar/rechazar/devolver, y registrar **sólo evidencia no sensible** (códigos de estado y formas de respuesta, sin identificadores ni datos personales).

## 7. Devoluciones, contracargos y eliminación de cuenta

* **Devolución total (602) confirmada**: no extiende el período, el acceso termina al confirmarse (sin gracia) y el período queda **anulado** (se conserva en el historial; deja de respaldar el estado). Auditoría `refund_applied`.
* **Parcial (605) o ambigua (601, 610)**: revisión manual (`refund_review`); el estado no cambia solo.
* **Contracargo**: Mobbex **no documenta** código ni aviso. Se soporta (i) por el adaptador (resultado `chargeback`, probado con el falso) y (ii) por el registro manual conciliado `billing_record_manual_outcome` (sólo sube la jerarquía de una ejecución existente, deja revisión abierta y pide recalcular). Efecto: **modo limitado inmediato** aunque quede período pagado; un cobro aprobado posterior lo supera. Revisión `chargeback_review`.
* Nunca se borran datos. Las auditorías no llevan datos sensibles.
* **Eliminación de cuenta** (decisión 5): el flujo existente (reautenticación → PDF → cuenta) suma, **sólo con facturación encendida**, un paso previo: cancelar en el proveedor, **confirmar** con una consulta autenticada (suspendido o terminado) y recién entonces seguir. Si no se puede confirmar (proveedor caído, estado ilegible, plan ignorado) la cuenta **no se elimina**. El registro fiscal mínimo y seudonimizado (referencia, fecha, importe, moneda, estado, comprobante, huella) se guarda al registrarse cada cobro, **sin clave foránea**, 10 años, con huella SHA-256 salada de la cuenta: sobrevive al borrado en cascada y no contiene propietaria, DNI/CUIT, tarjeta ni cargas útiles. Su única purga es la del plazo vencido. ARCA exige conservar documentación y libros al menos 10 años; el texto exacto de retención conviene validarlo con quien lleve la contabilidad.

## 8. Ensayo SQL (BEGIN … ROLLBACK)

`supabase/tests/postgres/m2_migration_rehearsal.cjs` (Postgres 17 real, 48 tablas y 144 filas de la aplicación + dos propietarias), **sin `db push`**:

1. `BEGIN` → aplicar las tres migraciones → cuerpos, privilegios, RLS, índices, triggers, restricciones y políticas con huella md5 → huellas de **todas** las tablas de datos de la aplicación idénticas → `ROLLBACK` → ningún objeto de facturación queda y todo es idéntico al previo.
2. Aplicar de verdad: inventario y huellas **idénticos a los ensayados**; reaplicar es idempotente (mismo inventario, mismas huellas, mismas cuentas y catálogo).
3. Dos propietarias sin cruces; `anon` sin nada; `authenticated` sólo lee su fila y sus períodos (columnas explícitas) y nada más; las escrituras sensibles sólo por funciones `billing_*` de `service_role`; `SECURITY DEFINER` únicamente en `billing_ensure_account`; todas fijan `search_path`.
4. **Rollback reproducible** (`supabase/repairs/m1_billing_rollback.sql`): vuelve a la base previa *exactamente* (el registro fiscal se conserva a propósito; borrarlo es una sentencia explícita y comentada), es idempotente y reaplicar deja las mismas huellas; también limpia una base con M1 sola.

## 9. Con los interruptores apagados no cambia nada

Pruebas estructurales (`m2-structure.test.ts`) y de comportamiento: las tres pantallas piden los datos y responden **404** antes de usarlos; las tres rutas de API responden 404 **antes** de leer el cuerpo, el secreto o la base; el menú de cuenta, el diálogo de eliminar cuenta y Configuración reciben `billingEnabled` con valor por defecto falso y sólo renderizan algo nuevo detrás de él; la eliminación de cuenta agrega su paso sólo con el interruptor encendido; `proxy.ts` y la barra principal no importan nada de facturación; `lib/billing` sólo lo importan los puntos aprobados (lista cerrada). La suite completa de la aplicación (incluido todo lo anterior) sigue verde.

`BILLING_ENFORCEMENT_ENABLED` además sigue sin estar conectado: `resolveBillingAccess` no se usa en ningún flujo (M3).

## 10. Amenazas nuevas de M2

| Amenaza | Defensa | Prueba |
|---|---|---|
| Aviso falso que dice «aprobado» | el cuerpo no decide nada: sólo una pista; estado por consulta autenticada | `notice-ingest`, DB 5.17 |
| Aviso con identificadores inventados para forzar consultas al proveedor | se resuelve la propietaria en la base **antes** de consultar; los ajenos no consultan | DB 5.4, 6.8 |
| Avalancha de avisos | límite por cliente y global, tope de cuerpo, dedupe en la base con enfriamiento, una anotación por hora de ajenos | `notice-ingest`, DB 6.17 |
| Cuerpo enorme / mentir con `Content-Length` / flujo infinito | lectura con tope, 413 antes de interpretar | `http-redirect`, `notice-ingest` |
| Contenido malformado o hostil (JSON roto, ids con SQL, claves de prototipo, miles de campos) | esquema mínimo + patrón de ids + topes | `notice-ingest` |
| Fuga de existencia de un suscriptor | respuesta 200 uniforme | `notice-ingest` |
| Redirect manipulado hacia otro sitio | sólo HTTPS de `mobbex.com` o ruta interna; se descarta todo lo demás | `http-redirect` |
| Volver del proveedor para «activar» | la pantalla ignora la URL; sólo cobros conciliados activan | `m2-structure`, DB 6.10 |
| Plan, precio o moneda alterados | el navegador sólo manda un código de plan; el precio sale del catálogo del servidor y la base lo revalida | M1 + `m2-structure` |
| Doble clic / dos pestañas en el checkout | un intento vivo por cuenta; mismo enlace reutilizado; 0 llamadas al proveedor en repeticiones | DB 3.3, 6.10 |
| Dos suscriptores con medio de pago (cambio de plan antes de pagar) | se cancela el anterior antes de crear el nuevo | DB 6.10 |
| DNI/CUIT filtrado | nunca persistido ni registrado; errores sin eco; borrado al salir | DB 6.10, `m2-structure`, `view` |
| Cancelación a medias (proveedor confirmó, base falló) | proveedor primero + reparación por sondeo + idempotencia | DB 6.9 |
| Cobrar a quien canceló | si el proveedor sigue activo y la base dice cancelada, se vuelve a suspender | DB 6.9 |
| Eliminar la cuenta sin cancelar el cobro | cancelar y confirmar antes de borrar; sin confirmación no se elimina | `account-deletion`, DB 6.12 |
| Devolución parcial tomada como total | sólo `602` es total; el resto a revisión | `refunds-chargebacks`, DB 6.3 |
| Contracargo sin código en la API | resultado manual conciliado + adaptador; limitado inmediato | DB 6.4 |
| Proveedor caído en el sondeo | backoff hasta 6 h, revisión tras 8 fallas, nada se activa | DB 6.7 |
| Cron invocado sin permiso | secreto Bearer en tiempo constante; apagado = 404 | `http-redirect`, `m2-structure` |
| Registro fiscal con datos personales o editable | sin propietaria, huella salada, sin clave foránea; RLS sin políticas; purga sólo vencido | DB 6.1 |

## 11. Escala

Resultados de `supabase/tests/postgres/m2_billing_scale.mjs` con **1.000 suscripciones activas** (Postgres 17 real, varias conexiones simultáneas; todos los datos en [`m2-scale-metrics.json`](./m2-scale-metrics.json)). Es un requisito **técnico**, no una proyección comercial ni fiscal. Máquina de desarrollo con Postgres local: los tiempos varían entre corridas y en producción el costo dominante será el proveedor.

| Prueba | Resultado |
|---|---|
| **Recepción de 5.000 avisos** (2.000 duplicados exactos, desordenados, 20 conexiones simultáneas) | 5.000 respuestas **200**; p50 10,4 ms, p95 17,2 ms; 1.774/s; en la base quedan **1.500** (los 3.500 repetidos se descartan por la clave de la pista) |
| **Procesamiento concurrente** (4 trabajadores, lotes de 500) | 0,39 s; **24 consultas** a la base para 1.500 avisos (5 por lote, **cero por suscripción**); heap 30 MB; las 1.000 renovaciones activadas **exactamente una vez**; las 500 operaciones inexistentes quedaron como **500 anomalías** (una por pago); 1.500 consultas al proveedor (una por pago y lote) |
| **Trabajador que muere a mitad** | sus 500 avisos siguen «en proceso» mientras vive el arrendamiento; vencido, se recuperan y procesan **una sola vez**: 3 períodos por cuenta, ninguno duplicado |
| **Barrido global del proveedor** (cobros sin aviso) | 20 páginas de 50, 1.000 cobros recuperados con **9 consultas** a la base; repetirlo no duplica nada |
| **Sondeo por suscriptor** (1.000 cobros cuyos avisos nunca llegaron; 3 trabajadores concurrentes) | cada suscriptor reclamado y sondeado **exactamente una vez** (1.000/1.000); 1.000 consultas al proveedor (la única llamada por suscriptor, externa); **33 consultas** a la base en 5 lotes; 0,48 s; heap 77 MB; las 1.000 cuentas vuelven a *activa* con 5 períodos y sin duplicados; una segunda corrida inmediata no encuentra nada vencido |
| **Barrido del reloj** (todas vencen el mismo día) | vencimiento y fin de gracia en 2 páginas de 500, **19 consultas**; repetir no evalúa ninguna cuenta |
| **Registro fiscal** | 5.000 registros (uno por cobro aprobado), sin duplicados, todos con huella seudonimizada |
| **Planes de consulta** (61.500 avisos en la tabla) | **0 recorridos completos**: reclamo, recuperación de arrendamientos, retención, deduplicación, sondeos, cobros por cuenta, vencimientos y purga fiscal usan su índice |

Las renovaciones concentradas en la misma hora no se sondean en el mismo segundo (dispersión de ±10 % por cuenta).

## 12. Verificación y resultados

Todo sobre el árbol final del commit de M2 (rama `m1-billing`):

| Verificación | Resultado |
|---|---|
| `tsc --noEmit`, `eslint .`, `git diff --check` | limpios |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| **Suite completa en copia LF** | **1.406 de 1.406** (1.321 al cierre de las decisiones de M1; 85 pruebas nuevas de M2 y 9 pruebas previas de navegación/rutas actualizadas a propósito para los nuevos puntos de conexión) |
| Build de producción (**Turbopack**, copia con `node_modules` real) y con webpack | OK; las rutas nuevas aparecen y todas las anteriores siguen |
| `bundle_scan.mjs` | navegador sin credenciales, interruptores, funciones, planes, importes ni rutas de facturación; servidor sin valores secretos (859 archivos) |
| Humo del build con **interruptores apagados** | webhook (POST/GET/PUT), cron (con y sin Bearer) → **404**; `/login` 200. Encendida sin clave de servicio: webhook y cron → 503 (cerrado), cron sin Bearer → 401 |
| Batería sobre **Postgres real** (`m1_billing.mjs`) | **66 de 66** sobre las tres migraciones: RLS con dos propietarias, privilegios, integridad, checkout con 10 conexiones, avisos no confiables, arrendamientos, concurrencia, registro fiscal, devoluciones y contracargos, sondeo, reparación, eliminación, cambio de plan y trabajos |
| Ensayo `BEGIN … ROLLBACK` (`m2_migration_rehearsal.cjs`) | todo ok (§8) |
| **Mutaciones** | **164 de 164** del dominio · **51 de 51** de las migraciones (Postgres real) · **15 de 15** del procesador/almacén/comandos contra Postgres real |
| Capturas 1440/390/320 (19 pantallas × 3) | 57 capturas, ninguna con desborde horizontal ni errores de consola |

Defectos reales que encontraron estas pruebas durante M2 (corregidos, cada uno con prueba propia): cancelar a quien había completado el checkout pero aún no pagaba no llegaba al proveedor; al re-suscribirse tras cancelar se ignoraba al suscriptor nuevo; el doble envío del checkout podía crear un segundo suscriptor; una renovación devuelta conservaba la gracia completa; las guardas de navegación/rutas de la suite previa tuvieron que reconocer el nuevo destino (a propósito).

Honestidad sobre lo que **no** se pudo verificar: no hay sesión de Supabase ni clave de servicio, así que el clic de los botones contra la base real (Server Actions de punta a punta desde el navegador) no se ejecutó; se verificó por tipos, build, guardas estructurales y —para el dominio y la base— por las baterías de arriba. Las capturas son del navegador de escritorio emulado, no de un dispositivo real.

## 13. Requisitos externos pendientes (lista exacta)

Nada de esto lo puedo suplir sin ustedes; M2 no depende de ello para estar completo, pero **la activación sí**:

1. **Credenciales sandbox de Mobbex** (clave de API y token de acceso de la cuenta de pruebas) y los **UIDs de las 4 suscripciones plantilla** (se crean con `buildCreateSubscriptionRequest`). Se cargan sólo como variables de servidor de un entorno de *Preview*, nunca en archivos ni en el chat.
2. **Consulta escrita a Mobbex**: (a) ¿ofrece firma, secreto o lista de IP oficial para los avisos? (b) forma del contenido de `executions` y valor de estado de un suscriptor suspendido; (c) comportamiento de «mover suscriptor» (agenda y cobro inmediato); (d) ¿la URL de control permite cambiar el medio de pago?; (e) unicidad de `reference` de suscriptor ante re-suscripción; (f) código o aviso de **contracargo**; (g) límites de tasa de la API; (h) ¿el formulario alojado puede capturar el DNI/CUIT con vinculación segura a la propietaria? (si sí, se prefiere ese método).
3. **`SUPABASE_SERVICE_ROLE_KEY`** en Vercel (sólo servidor): decisión 1 aprobada, **configuración pendiente**.
4. **Aplicar las tres migraciones** (`db push`, cuando se autorice) y fijar el corte de cuentas existentes; `BILLING_GRANDFATHER_CUTOFF` con el mismo instante guardado en `billing_settings`.
5. **`CRON_SECRET`** (32+ caracteres), el `vercel.json` con los cron (ver el ejemplo) y una **regla de límite de tasa de la plataforma** para `/api/billing/webhooks/mobbex` (el límite por instancia es sólo la primera barrera).
6. **URL de avisos** en la configuración de Mobbex: `https://teacherflowapp.com/api/billing/webhooks/mobbex`.
7. **Canal de soporte** (correo público): decisión de Joaquín (CLAUDE.md: «correo público de soporte»). Las pantallas dicen «contactanos» sin un enlace inventado; con el correo definido se agrega.
8. **Textos legales**: política de privacidad con el tratamiento de DNI/CUIT y la conservación fiscal de 10 años, términos de la suscripción y emisión de comprobantes (razón social, condición tributaria). Nada de esto está inventado en el producto.
9. **Prueba extremo a extremo en sandbox** con evidencia no sensible (crear, consultar, cancelar, estados, devolución).
10. **Revisión visual en dispositivo real** (las capturas son del navegador de escritorio emulado).
11. Antes de M3: decidir `BILLING_STATE_COOKIE_SECRET` y cómo se transporta el comprobante firmado de la última verificación.

> **Actualización M3 (14/10/2026):** el enlace de soporte ya depende de `BILLING_SUPPORT_EMAIL` y hay textos mínimos en borrador (`/facturacion/condiciones`, `BILLING_LEGAL_REVIEWED`). Variables, pasos de sandbox y plan de migraciones: `M3_PREPARACION.md`.

## 14. Qué NO hace M2

No aplica migraciones (`db push`), no despliega, no configura Vercel ni variables, no llama a Mobbex, no cobra, **no enciende** ningún interruptor, no conecta el control de acceso (`resolveBillingAccess` sigue sin usarse; M3), no modifica el rediseño ni ningún dato, y no empieza M3.
