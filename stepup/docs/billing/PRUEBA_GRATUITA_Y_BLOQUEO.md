# Prueba gratuita de 15 días y bloqueo sin pago aprobado (condición aprobada el 25/11/2026)

## Condición comercial (tal como se aprobó)

- 15 días gratis, **una sola vez por cuenta**; tarjeta obligatoria al contratar; **no se cobra el precio del plan al empezar**.
- Primer cobro automático el día calendario **inicio de la prueba + 15**, a las **00:00 (America/Argentina/Buenos_Aires)**. No se promete «360 horas»: se promete esa fecha.
- Después, renovación según el plan: mensual $ 25.900, trimestral $ 69.900, semestral $ 131.400, anual $ 238.800. El primer cobro es el **total** del plan.
- Antes de confirmar se muestra la fecha exacta del primer cobro y su importe: «15 días gratis. Luego $ 25.900 por mes.» + «Si confirmás hoy, el primer cobro de $ 25.900 será el 11/12/2026 a las 00:00 (hora de Argentina)…».
- Cuentas actuales (`grandfathered`): conservan su acceso; **no** reciben prueba automáticamente.
- Sin pago aprobado que cubra el período (fin de la prueba o de un período pagado) el acceso queda **bloqueado** (no es sólo lectura) y **no hay días de gracia**.

## Qué mecanismo programa el primer cobro (verificado contra la documentación oficial de Rebill)

1. **Prueba nativa de Rebill**: planes con `trialPeriodDays: 15` (docs.rebill.com › Plans). Rebill no cobra durante la prueba, **registra un pago aprobado de monto 0 y guarda el medio de pago**, y el primer cobro real es «fecha de inicio + `trialPeriodDays`». Se crean 4 planes y 4 payment links CON prueba (mismo precio y período que los normales; `metadata.tfTrial = "15"`) con `scripts/rebill-provision.mjs provision --trial`. Los planes normales no se tocan.
2. **Hora del cobro**: la documentación dice «inicio + N días» sin garantizar la hora (se calcula con la hora de la contratación). Para cumplir **00:00 de Argentina**, TeacherFlow fija `nextChargeDate` de la suscripción con `PATCH /v3/subscriptions/:id` (docs › «Update subscription»: «hoy o posterior») al instante `00:00 (AR) del día inicio + 15` (= 03:00 UTC) y **vuelve a leer la suscripción**: sólo si Rebill quedó con ESE instante se activa la prueba. Si no se puede, la prueba **no se activa** (la cuenta sigue sin acceso), queda una revisión abierta (`trial_schedule`) y el sondeo reintenta.
3. **Activación**: sólo cuando Rebill confirma (consulta autenticada) que la suscripción existe, está activa y `in_trial`, y el pago de 0 está aprobado (tarjeta registrada). Visitar la URL de éxito no alcanza. El pago de 0 **no es un cobro** (no crea ejecución ni período pagado).
4. **Primer cobro**: es un pago normal por el total del plan. Se concilia como cualquier otro: crea el período que empieza ese día y el acceso vuelve solo (sin cerrar sesión).

## Prueba única por cuenta (anti-repetición)

- `billing_subscriptions.trial_started_at/trial_ends_at` se guardan una vez y un disparador de la base los hace **inmutables** (ni un UPDATE directo los borra ni reinicia).
- El checkout elige el link CON prueba sólo si la cuenta es elegible (no `grandfathered`, sin prueba previa) y el proveedor lo tiene configurado; si pide prueba y no hay links de prueba, **falla cerrado** (nunca se vende sin prueba lo que se mostró con prueba).
- Un enlace viejo reutilizado (segunda suscripción con prueba en la misma cuenta) → no se activa, esa suscripción se pausa en Rebill y queda `trial_reused`. Cambiar de plan durante la prueba no está disponible (se puede después del primer cobro); cancelar y volver a contratar no da otra prueba.
- Cancelar durante la prueba pausa la suscripción en Rebill (no habrá primer cobro) y conserva el acceso hasta el fin de la prueba. Reactivar durante la prueba reprograma el primer cobro **exactamente** al fin de la prueba (00:00).

## Bloqueo sin pago aprobado (sin gracia, no sólo lectura)

- Estados: `past_due` (vencido sin resultado), `grace_period` (cobro rechazado; el nombre es histórico) y `limited` **no dan acceso**. Los reintentos de Rebill continúan y, al aprobarse, el acceso vuelve solo.
- **Páginas**: `proxy.ts` redirige a `/suscripcion-pendiente` toda ruta privada salvo `/suscripcion-pendiente`, `/facturacion/*` y `/configuracion` exacta (`lib/billing/blocked-paths.ts`). Aplica a enlaces directos y a navegaciones del cliente.
- **Datos y acciones del servidor**: la guarda de `fetch` (`enforcement.ts` + `write-guard.ts › allowedWhenBlocked`) bloquea **lecturas y escrituras** de datos operativos (403): sólo pasan sesión, dispositivo, cuota, eliminar la cuenta, perfil, preferencias, su facturación y listar/borrar archivos.
- **Base**: la compuerta de escritura (`COMPUERTA_EN_LA_BASE.md`) usa la misma regla sin gracia (`tf_write_access`, migración `20261126100000`). Las **lecturas** directas contra Supabase con la propia sesión no se bloquean en la base (sólo en el servidor web): es un límite conocido; no hay alumnos de otras cuentas expuestos (RLS).
- **Misma regla en navegador y en la web anclada al inicio del celular**: todo corre en el servidor; no depende del modo de pantalla.
- Pantalla «Suscripción pendiente»: importe, botón para pagar o actualizar el medio de pago, se actualiza sola y vuelve a Inicio apenas se aprueba el pago. Los datos **no se borran**.
- Todo esto sólo rige con `BILLING_ENFORCEMENT_ENABLED=true`; las cuentas actuales no se bloquean.

## Pruebas

`lib/billing/__tests__/*` (vista, acceso, ledger, bloqueo de rutas y datos), `supabase/tests/postgres/rebill_trial.mjs` (16 pasos: checkout, activación, hora exacta, cobro único, cancelación, rechazo/reintento, falla al fijar el cobro, segunda prueba, inmutabilidad, cuentas actuales), `rebill_lifecycle.mjs`, `m3_lifecycle.mjs`, `access_enforcement.mjs`, `billing_write_gate.mjs`.

## Qué NO se puede comprobar sin Rebill

Que el sandbox/producción de Rebill acepte el `PATCH nextChargeDate` sobre una suscripción `in_trial` y mantenga el instante hasta el cobro, y que el primer cobro se ejecute a esa hora, sólo se confirma con una suscripción real creada por una persona en el checkout (sandbox: un pago de prueba; producción: la primera contratación real). El procesamiento ya se prueba con un Rebill simulado que respeta lo documentado.
