# Compuerta de escritura en la base — diseño, alcance y activación (preparada 25/11/2026, NO aplicada)

**Estado:** migración `supabase/migrations/20261125130000_billing_write_gate.sql` preparada y probada en un Postgres aislado. **No se aplicó a Production.** Aun aplicada, queda **apagada** (`billing_settings.write_gate_enabled = false`): no cambia nada hasta encenderla.

## 1. El problema, demostrado

El modo limitado lo aplica el servidor web (`lib/billing/enforcement.ts`). Una cuenta limitada que usa **su propia sesión** contra la API de datos de Supabase (la clave pública viaja en la web; el token de sesión es suyo) escribe en **sus propias filas**, porque la base sólo aplica RLS por dueño y no mira la suscripción. Demostrado en el aislado local con llamadas HTTP directas: `INSERT` y `UPDATE` en `students` aceptados por una cuenta `pending`. No puede tocar datos de otras cuentas ni ejecutar `billing_*`. **No se demostró contra Production** (no se hacen escrituras allí); se infiere de que las migraciones son las mismas.

Las vías reales de escritura (verificadas en el código y en el catálogo):
- La web **no tiene** cliente de Supabase en el navegador: todo sale por el servidor con el JWT de la persona (`createSupabaseServerClient`).
- Escrituras directas de tabla desde la web: pocas (`test_data_exclusions`, `report_records`, `recurrence_rules`, `custom_levels`, `student_file_cleanup_jobs` y algunas `upsert`).
- Funciones de escritura (`WRITE_RPC`, 71): 67 son `SECURITY DEFINER` ejecutables por `authenticated`; escriben aunque la tabla no conceda permiso directo.
- Archivos: buckets `lesson-files` y `report-pdfs`.
- 30 de las 84 tablas de `public` conceden escritura directa a `authenticated`; las demás sólo se escriben a través de funciones.

## 2. Alternativas evaluadas y por qué esta alcance

| Alternativa | ¿Cubre las funciones `SECURITY DEFINER`? | Costo / riesgo | Decisión |
|---|---|---|---|
| **A. Política RLS restrictiva** por tabla | **No**: el dueño de la función se saltea RLS | mismo número de tablas que B, y deja sin proteger 67 funciones | descartada |
| **B. Disparador de sentencia en las tablas escribibles** | **Sí** (los disparadores corren siempre) | 59 disparadores del mismo código; costo por sentencia, no por fila | **elegida** |
| **C. Disparador sólo en ~17 tablas «ancla»** (cobertura mínima calculada) | Sí, **si** el análisis estático no se equivoca | una función que llegue a su ancla sólo por una rama poco usada quedaría sin proteger, sin que nada lo avise | descartada: no es verificable |
| **D. Agregar el chequeo al comienzo de cada una de las ~71 funciones** | Sí | reescribir 71 funciones grandes ya probadas (riesgo de regresión alto) | descartada |
| **E. Reclamo en el JWT** (`limited`) y RLS que lo lea | Parcial | el token dura hasta 1 h: pagar no desbloquea en el acto | descartada |
| **F. Quitar permisos de tabla / mover todo a funciones** | n/a | cambia la arquitectura (las funciones `INVOKER` necesitan los permisos) | descartada |

**Por qué 59 tablas y no 1 ni 84:** sólo hacen falta las tablas donde una cuenta **puede** escribir datos operativos (permiso directo o a través de una función de `WRITE_RPC`). El resto (facturación, importaciones internas, sesiones) o no son escribibles por una cuenta o son operaciones permitidas en modo limitado. La lista es **explícita** en la migración y una **prueba de catálogo** la compara con la base: una tabla escribible nueva sin clasificar rompe la prueba (obliga a decidir «con compuerta» o «exenta con motivo»). Con menos tablas (opción C) no se puede demostrar cobertura; con todas, se bloquearían operaciones permitidas.

## 3. Cómo funciona

- `tf_write_access(owner, ahora)`: espejo SQL de `projectStatus` (`lib/billing/ledger.ts`): grandfathered, activa, en demora, en gracia y cancelada-con-período-pagado escriben; pending, limitada, cancelada vencida, expirada y contracargo, no. Sin fila de suscripción: misma regla que `billing_ensure_account` (anterior al corte escribe). **Una prueba compara SQL y TypeScript en 2.280 casos** (bordes del día civil argentino incluidos); si se separan, falla.
- `tf_write_gate()`: disparador de **sentencia** (una evaluación por escritura). Sólo actúa si la sesión es el rol `authenticated`, el interruptor está encendido y la cuenta no puede escribir; levanta `TF006` con el mensaje breve del modo limitado.
- No actúa para: servicio de facturación, tareas programadas, migraciones, administración; escrituras derivadas dentro de otro disparador o de una cascada (`pg_trigger_depth() > 1`, así eliminar la propia cuenta sigue funcionando).
- Archivos: política restrictiva de inserción y reemplazo en `lesson-files` y `report-pdfs`; borrar y leer no cambian.
- `tf_can_write()`: informa a la sesión su propio estado (ya lo puede leer en `billing_subscriptions`).
- Exentas (sin compuerta, con motivo): `teacher_interaction_preferences`, `cloud_backups` (tabla de la app antigua), `web_device_sessions`, `active_sessions`, `account_action_events`.
- La interfaz traduce `TF006` y `TF_BILLING_LIMITED` al mismo mensaje breve con acceso a Facturación.

## 4. Qué se conserva (probado)

RLS y aislamiento entre cuentas; cuentas existentes y que pagaron escriben igual (tabla y función); operaciones permitidas (preferencias, sesión, cuota, eliminar la cuenta con cascada, borrar archivos); recuperación **en el acto** al registrar el pago (sin caché ni espera) y vuelta a bloqueo al vencer; apagar el interruptor devuelve el comportamiento anterior sin tocar datos ni funciones; las suites existentes de la base (calendario, cobros, importación, retención, sesiones, facturación…) dan el mismo resultado con y sin la migración.

## 5. Límites conocidos (no ocultos)

- No se probó contra el Supabase alojado (no hay proyecto de prueba): sí contra Postgres 17 real con las migraciones reales y roles/RLS reales, y contra una pasarela local con la semántica de PostgREST.
- Funciones con SQL dinámico (`apply_undo_backup_import`, `delete_student_permanently`, `apply_financial_reconciliation`): su destino exacto no se ve estáticamente; se verificó que todas las tablas que mencionan tienen compuerta y que cada una escribe además en una tabla con compuerta de forma estática (el llamado completo se revierte).
- Una URL firmada de subida ya emitida antes del vencimiento sigue válida hasta que caduca; la política de archivos la cubre sólo para subidas directas con la sesión.
- La app Expo antigua del repositorio original (no hay evidencia de uso) escribiría `cloud_backups`: está exenta. Si alguien la usara, la compuerta bloquearía sus escrituras sobre las demás tablas **sólo** si la cuenta está limitada.
- El estado de la base y el del servidor web leen la misma tabla, pero son dos interruptores: `BILLING_ENFORCEMENT_ENABLED` (web) y `write_gate_enabled` (base). Hay que encenderlos juntos.

## 6. Activación y reversión (cuando Joaquín lo decida; **nada de esto se ejecutó**)

1. Aplicar la migración en Production con el interruptor apagado (cambio sin efecto visible). Verificar: `select write_gate_enabled from billing_settings` = false; 59 disparadores `tf_write_gate`.
2. Con las cuentas existentes `grandfathered` (5) y el piloto, comprobar en un entorno de preparación o con la cuenta QA que escribir sigue igual.
3. Encender: `update public.billing_settings set write_gate_enabled = true;` junto con `BILLING_ENFORCEMENT_ENABLED=true` y `BILLING_GRANDFATHER_CUTOFF` (ver `CONTROL_DE_ACCESO.md` §7).
4. Vigilar errores `TF006` y el aviso de modo limitado.
5. **Reversión inmediata:** `update public.billing_settings set write_gate_enabled = false;` (sin migración inversa).

## 7. Pruebas

`node supabase/tests/postgres/billing_write_gate.mjs` (18 pasos): apagada = sin cambios; encendida bloquea tabla, función y archivos; permitidas siguen; eliminar cuenta; RLS; roles de servicio; recuperación y vencimiento en la misma conexión; espejo SQL=TypeScript; cuenta sin fila; cobertura de catálogo; reversión; permisos de las funciones nuevas. Más `lib/errors/__tests__/limited-mode-message.test.ts` (mensaje, códigos, errores técnicos intactos).
