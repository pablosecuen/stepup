# Control de acceso por suscripción — qué hace, cómo se prueba, cómo se activa y cómo se revierte

Estado al 25/11/2026: **APAGADO** (`BILLING_ENFORCEMENT_ENABLED` no existe en Production). Con el interruptor apagado el sistema se comporta exactamente como antes: no se envuelve ningún cliente, no se hace ninguna consulta de más y ningún usuario ve un aviso.

## 1. Qué conserva una cuenta sin pago (modo limitado)

| Puede | No puede |
|---|---|
| Ingresar, ver y exportar todos sus datos | Crear o modificar alumnos, clases, series, registros, cobros a alumnos, reportes, archivos |
| Entrar a Facturación, pagar, cancelar, ver su historial | Importar datos |
| Contactar a soporte (correo del titular, siempre visible) | |
| Eliminar su cuenta (se cancela antes la suscripción) | |
| Cambiar sus preferencias de uso (navegación, etc.) | |

Un pago fallido o una cancelación **nunca borra datos**.

## 2. Línea de tiempo (la regla es `lib/billing/access.ts` + `ledger.ts`, probada)

| Situación | Acceso | Qué ve la persona |
|---|---|---|
| Cuenta existente (anterior al corte) | Completo, siempre | Nada |
| Cuenta nueva sin pago | **Limitado** desde el primer día (no hay período de prueba) | «Modo limitado» + Ir a Facturación |
| Pagó (período vigente) | Completo hasta el fin del período | Nada |
| Venció el período, el cobro está en proceso | Completo (hasta el fin de la gracia) | Nada |
| El cobro de renovación fue **rechazado** | **5 días corridos completos** con aviso | «Hay un problema con tu pago» |
| Pasó la gracia sin pago (00:00 del sexto día) | **Limitado** | «Modo limitado» |
| Rebill agotó sus reintentos (`paused` + `defaulted`) | La suscripción termina (`expired`): **limitado**, y puede **volver a suscribirse** | «Modo limitado» + Facturación |
| Canceló la renovación | Completo hasta el fin de lo pagado; después limitado | «Tu suscripción termina pronto» |
| Contracargo confirmado | Limitado de inmediato | «Modo limitado» |
| Devolución total confirmada | El período devuelto deja de dar acceso | según el caso |

Reintentos de Rebill (documentación oficial): 4 reintentos en 10 días (2, 2, 3 y 3 días); al agotarse la suscripción queda `paused` con `statusDetail: defaulted`. Como la gracia de TeacherFlow (5 días) termina antes, hay un tramo en que la cuenta ya está limitada y Rebill todavía puede reintentar: si un reintento se aprueba, el acceso completo vuelve solo.

## 3. Qué cuentas existentes quedan exceptuadas y por qué

`billing_settings.grandfather_cutoff` = `2026-10-14T14:20:36.871448+00:00` (se fijó UNA vez al aplicar la facturación). Toda cuenta creada hasta ese instante nació `grandfathered`: acceso completo **para siempre**, sin ningún camino automático que la saque de ese régimen (sólo una decisión explícita futura, `grandfather_ended`).

Medido en Production el 25/11/2026 (sólo agregados): 5 cuentas, 5 con fila de facturación `grandfathered`, **0 creadas después del corte** (la más reciente: 04/10/2026). Es decir: **ninguna cuenta existente se bloquea al activar**. Sólo las cuentas que se creen después serán `pending` → limitadas hasta pagar.

## 4. Cómo se recupera el acceso después de pagar

El acceso lo da un cobro aprobado y conciliado con la consulta autenticada a Rebill (nunca volver de la página de pago). Al pagar, el estado pasa a `active` (por aviso o por el cron de 5/15 minutos) y la guarda deja escribir en cuanto se actualiza su caché de 10 segundos. Desde `pending`, `canceled` o `expired` se contrata de nuevo desde Facturación.

**Hueco conocido (decisión pendiente):** una cuenta que está `limited` porque se rechazó su renovación, y cuya suscripción todavía no terminó en Rebill, hoy puede **cancelar** o escribir a soporte, pero no cambiar la tarjeta (la actualización del medio de pago está apagada hasta validarla en sandbox) ni volver a suscribirse (todavía figura como suscripta). Dura hasta que Rebill apruebe un reintento o agote los suyos (≤ 10 días desde el rechazo). Se cierra validando `paymentMethodUpdate` en el sandbox y declarando `REBILL_VALIDATED_CAPABILITIES=paymentMethodUpdate`.

## 5. Dónde se valida (servidor, no sólo interfaz)

- **UN solo punto:** `requireAuthenticatedDbContext` arma el cliente de Supabase de la persona con un `fetch` protegido (`lib/billing/enforcement.ts`). Todas las lecturas y escrituras de datos de la web pasan por ahí; el navegador no habla con Supabase para datos (una prueba lo verifica).
- **Qué decide:** `lib/billing/write-guard.ts` clasifica cada pedido. Lecturas, sesión (`/auth/v1`), funciones de lectura, sesión del dispositivo, preferencias, descargas firmadas, borrado de archivos y `delete_own_account` pasan; **cualquier otra escritura se bloquea con un 403 sin llegar a la base** (falla cerrado: una función nueva sin clasificar se bloquea, y una prueba estructural obliga a clasificarla).
- **Facturación no se bloquea nunca:** usa el cliente de servicio del almacén de facturación, aparte del de la persona.
- **El aviso es sólo información** (`AccessBanner`): quitarlo no habilita nada.
- Falla propia al leer el estado: cuenta anterior al corte → acceso; cuenta nueva sin verificar → limitada; cuenta que pagó → 72 h con su comprobante firmado (cookie HttpOnly firmada con `BILLING_STATE_COOKIE_SECRET`, que no puede fabricarse ni alargarse desde el navegador).

## 6. Cómo se probó (aislado: sin Production, sin usuarios reales)

- `lib/billing/__tests__/enforcement.test.ts` (12): clasificación de pedidos, completitud de funciones (lee las migraciones), guarda con estados reales de cuenta (existente, nueva, activa, vencida, gracia, limitada, pago de vuelta, cancelada, contracargo), falla propia con y sin comprobante, caché, apagado = sin cambios.
- `supabase/tests/postgres/rebill_lifecycle.mjs` pasos 19–21: Postgres real + Rebill simulado: gracia → limitada → `defaulted` → expirada → volver a pagar → acceso completo.
- Pendiente de comprobar con un navegador sobre una cuenta NUEVA de prueba, **después** de activar (ver §7).

## 7. Procedimiento de activación (cuando Joaquín lo autorice) y reversión

Prerrequisitos: la prueba real de pago verificada (`PRUEBA_REAL_Y_APERTURA.md`), decisiones de §4 y de los textos tomadas, y `BILLING_LEGAL_REVIEWED=true` **sólo si** hubo revisión legal efectiva.

1. Confirmar el corte en la base (sólo lectura): `select grandfather_cutoff from public.billing_settings;` → debe dar `2026-10-14 14:20:36.871448+00`.
2. Cargar en Vercel Production `BILLING_GRANDFATHER_CUTOFF=2026-10-14T14:20:36.871448+00:00` (el mismo instante; ya existe `BILLING_STATE_COOKIE_SECRET`).
3. Cargar `BILLING_ENFORCEMENT_ENABLED=true` y **volver a desplegar** (las variables rigen desde el próximo despliegue).
4. Verificar con la cuenta QA (existente → acceso completo, sin aviso) y con UNA cuenta nueva de prueba (limitada: ver datos, no crear; pagar desde Facturación recupera el acceso). Mirar los registros: sólo `write_blocked` de la cuenta de prueba.
5. **Reversión inmediata:** quitar `BILLING_ENFORCEMENT_ENABLED` (o ponerla en `false`) y volver a desplegar. No hay datos que deshacer: el estado de las suscripciones no cambia, sólo deja de aplicarse la restricción.
