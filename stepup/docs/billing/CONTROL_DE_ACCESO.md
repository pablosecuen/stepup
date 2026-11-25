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

## 8. Prueba aislada conectada a una base real (25/11/2026) y rutas que podrían eludir la guarda

**Entorno:** `supabase/tests/postgres/access_enforcement.mjs` (10 pasos): cliente de supabase-js real → guarda real → pasarela local con la semántica de PostgREST → Postgres 17 real con todas las migraciones, RLS y roles. **No es el Supabase alojado**: no hay Docker ni un proyecto de prueba separado, y no se usó Production. No se prueba el despliegue de Next/Vercel ni la verificación de firma del JWT de GoTrue; sí el cliente, la guarda, el estado de facturación y la base.

| Comprobado | Resultado |
|---|---|
| Cuenta existente (grandfathered): lee y escribe (tabla y función) con la guarda encendida | pasa |
| Cuenta nueva sin pago: lee y exporta sus datos con RLS aislado | pasa |
| Cuenta limitada: `update`, `insert`, `delete`, una función de escritura, una función nueva sin clasificar y subir un archivo → **403 con el mensaje de modo limitado; ninguna llegó a la pasarela y la base quedó intacta** | pasa |
| Cuenta limitada: preferencias de uso, descarga firmada, borrar archivos y abrir un intento de pago (cliente de servicio) | pasa |
| Aislamiento: una cuenta limitada no afecta a otra | pasa |
| Pagar (cobro aprobado + período + estado) devuelve la escritura; vencido el período y la gracia, vuelve a limitarse | pasa |
| Interruptor apagado = ninguna guarda | pasa |

**Clientes privilegiados y otros caminos (auditados en el código y en la base):**

- **Cliente de servicio** (`SUPABASE_SERVICE_ROLE_KEY`): un solo archivo (`supabase-store.ts`) y sólo funciones `billing_*` (prueba estructural). Un usuario autenticado **no puede ejecutarlas** por la API (permission denied, verificado en la base). No puede escribir datos operativos de una persona.
- **Otros clientes de servidor** (`createSupabaseServerClient` sin el contexto de la persona: sesión, dispositivo, recuperación de sesión): hoy sólo hacen autenticación o las funciones permitidas del dispositivo. Como **red de seguridad**, ese constructor trae una guarda por defecto que toma la cuenta del JWT de cada pedido (probada: bloquea a la limitada y deja pasar a la existente).
- `lib/transfer` (traslado de datos desde la app Expo antigua del repositorio original, no usada hoy) recibe un cliente inyectado y no se llama desde ninguna ruta de la web.
- `proxy.ts` y `reauth-supabase.ts`: sólo autenticación.

**Aclaración sobre «móvil»:** TeacherFlow en el celular es **la misma página web** anclada a la pantalla de inicio (PWA). No hay una aplicación móvil independiente en uso. El modo instalado y el navegador usan el mismo servidor, las mismas cookies y las mismas reglas: la guarda corre en el servidor y no mira el modo de pantalla ni el agente de usuario, y el `sw.js` no intercepta pedidos (sin manejador `fetch` ni caché), sólo atiende notificaciones. Una versión anterior de este documento llamó «app móvil» al código de la app Expo del repositorio original; **no hay evidencia de que esté publicada ni de que se use**, y no se la probó.

**Límite real, NO resuelto por esta guarda (verificado por separado):** **una llamada directa a la API de datos de Supabase con la propia sesión de una cuenta limitada escribe igual** en sus propias filas, porque la base sólo aplica RLS por dueño (`students_owner_all` y similares) y no consulta la suscripción. Hace falta que la persona obtenga su propio JWT (por ejemplo de su sesión en el navegador) y use la clave pública que viaja en la web; no puede tocar datos de otras cuentas ni ejecutar las funciones `billing_*` (sólo `service_role`). Está demostrado en el aislado local (paso 9 de `access_enforcement.mjs` y llamadas HTTP directas a la pasarela local: INSERT y UPDATE aceptados con una cuenta `pending`). **No se demostró contra Production** (no se hacen escrituras allí); se infiere de que las migraciones son las mismas. Para cerrarlo haría falta una **compuerta en la base** (por ejemplo un disparador que consulte el acceso en las tablas operativas, con el estado mantenido en la base): es una migración mayor con riesgo propio, **no se preparó** y su necesidad depende de decidir cuánto importa este riesgo. Mientras tanto el modo limitado es una restricción **de la web**.

## 9. La excepción de las cuentas existentes (`grandfathered`): duración y alcance

**Qué es hoy:** una cuenta creada hasta el corte guardado en `billing_settings` (`2026-10-14T14:20:36.871448+00:00`) quedó marcada `grandfathered` en `billing_subscriptions`. Esa marca da **acceso completo y gratis sin vencimiento**: no hay fecha de fin, ni cuenta regresiva, ni ningún proceso automático que la saque de ahí. En el código existe el disparador `grandfather_ended` (pasa a `pending`) **sin ningún comando, pantalla ni función de base que lo ejecute**: terminar la excepción exige desarrollo nuevo y una decisión explícita.

**Alcance:** las 5 cuentas actuales (todas anteriores al corte; ninguna posterior). La marca es **por cuenta**, no por fecha de alta: la variable `BILLING_GRANDFATHER_CUTOFF` **no crea ni quita** la excepción. Sólo se usa cuando el estado de una cuenta no se puede leer (falla propia) para saber si es anterior al corte. **No está configurada y no se configuró**.

**Cómo se pierde la excepción hoy:** sólo si la cuenta se suscribe (su primer período pagado la saca de `grandfathered` y pasa a las reglas normales: si después cancela o deja de pagar, queda limitada).

**Opciones para decidir (cada una exige una definición de Joaquín):**
1. **Permanente** (como está): las 5 cuentas nunca pagan salvo que quieran.
2. **Con fecha de fin**: elegir una fecha y un aviso previo; hay que construir el comando que termine la excepción en esa fecha (o a pedido, cuenta por cuenta) y avisar a las personas.
3. **Gratuidad acotada** (por ejemplo un período fijo desde la activación) y luego conversión.
4. **Cuenta por cuenta**: algunas permanentes (cuentas propias o de prueba) y otras con fecha.

