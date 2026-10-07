# R4 — Retención, borrado seguro, reautenticación y marcador firmado

Cierra cuatro hallazgos de la auditoría defensiva (`auditoria-2026-10-06/INFORME.md`): **M-05** (la retención de 30 días de las importaciones no existía), **M-06** (eliminar la cuenta con sólo una sesión, y PDF huérfanos en Storage) y **L-06** (marcador de recuperación sin firma). No incluye R5, el borrado de otras tablas vencidas (claims, limpiezas de PDF), RLS general, la app móvil ni cambios visuales.

## 1. Qué cambia, en una tabla

| Hallazgo | Antes | Ahora | Dónde |
|---|---|---|---|
| **M-05** Retención de importaciones | Respaldo completo (hasta 20 MB, con nombres, teléfonos y notas de alumnos) y snapshots guardados **para siempre**; `payload_purged_at` no se escribía en ningún lado | `purge_expired_import_data()` borra lo que cumplió su retención, **programada cada hora con pg_cron** | Base (migraciones `20261008100000` y `20261008120000`) |
| **M-06 (b)** PDF huérfanos | Al eliminar la cuenta los PDF de reportes quedaban en Storage para siempre | La web borra **todos** los PDF de la cuenta y comprueba que no quede ninguno **antes** de eliminar la cuenta | Web (`lib/repositories/report-pdf-storage.ts`) |
| **M-06 (a)** Eliminar con sesión robada | Bastaba la sesión; la palabra «ELIMINAR» sólo se validaba en el navegador | Exige **contraseña** (reautenticación verificada en el servidor), valida la palabra en el servidor y limita los intentos por hora y por cuenta | Web + base (`20261008110000`) |
| **L-06** Marcador sin firma | `<id>.<hora>`: quien tuviera una sesión robada lo fabricaba a mano | **HMAC-SHA256** con un secreto que sólo existe en el servidor; sin secreto no se emite ni se acepta nada | Web (`lib/auth/recovery-marker.ts`) |

## 2. Estado real encontrado (sólo lectura, 7/oct/2026)

| Dato en Production | Valor |
|---|---|
| Filas en `import_previews`, `import_runs`, `import_run_row_snapshots`, `import_undo_previews`, candidatos a duplicado | **0** (nunca se importó nada en Production) |
| Reportes con PDF / objetos en el bucket `report-pdfs` / objetos huérfanos | **0 / 0 / 0** |
| Cuentas | 5 |
| `pg_cron` | disponible (versión 1.6.4), **no instalada** |

Consecuencia: ni la purga ni el borrado de PDF tocan ningún dato real al aplicarse; todo se probó con datos sintéticos.

## 3. Retención y purga de importaciones (M-05)

### 3.1 Reglas

| Qué | Cuándo se purga | Cómo | Por qué ese plazo |
|---|---|---|---|
| **Respaldo retenido** (`import_runs.retained_payload`) | 1 hora después de `undo_expires_at` (30 días tras importar) | Se pone en `NULL` y se escribe `payload_purged_at` | Es la retención de 30 días que ya declaraba `limits.ts` (`RUN_RETENTION_DAYS`); la hora de gracia evita carreras con un «deshacer» iniciado dentro del plazo |
| **Snapshots** (`import_run_row_snapshots`, copia fila por fila de lo escrito) | Igual que arriba | Se borran todos los de la corrida y se escribe `snapshots_purged_at` | Sin snapshots ya no se puede deshacer, y ya venció el plazo para hacerlo |
| **Corrida** (`import_runs`) | **No se borra** | Queda como historial: resumen y conteos, sin datos personales | La pantalla de historial y la FK de idempotencia la necesitan |
| **Preview aplicado** (`import_previews`) | 24 h después de vencer | Se vacía `normalized_payload`, `classification` y `excluded_collections`; se borran sus huellas y candidatos a duplicado (que guardan valores del alumno); queda la fila con `payload_purged_at` | La corrida lo referencia sin cascada y «aplicar» repetido sólo necesita que exista |
| **Preview nunca aplicado** (pendiente o vencido) | 24 h después de vencer | Se borra con sus huellas y candidatos (cascada). **Nunca** uno referenciado por una corrida | Ya no sirve para nada; antes sólo se limpiaba perezosamente por cuenta |
| **Preview de deshacer** (`import_undo_previews`) | 24 h después de vencer | Se borra | Sólo guarda ids de filas y motivos |

Lo que **no** se toca: alumnos, clases, pagos y cualquier otra tabla de la aplicación (comprobado con huellas), `cloud_backups`, ni el resumen de cada corrida.

### 3.2 Seguridad y concurrencia

* **No ejecutable por la API:** `EXECUTE` revocado a `public`, `anon`, `authenticated` y `service_role`; sólo el rol dueño (el que corre `pg_cron`). `SECURITY DEFINER`, `search_path` vacío. Devuelve sólo cantidades, nunca ids ni contenido.
* **Respeta aplicar y deshacer:** por cada corrida toma, **sin esperar**, el mismo lock por cuenta que usan esas operaciones (`pg_try_advisory_xact_lock(hashtext('backup_import:'||owner))`); si la cuenta está ocupada, esa corrida se salta y se purga en la próxima pasada. Las filas se toman con `FOR UPDATE SKIP LOCKED`: dos purgas simultáneas no se pisan.
* **Acotada:** lotes de hasta 200 (máximo 1000) por categoría y **25 corridas** por pasada (una corrida puede tener decenas de miles de snapshots). Con la programación horaria, un atraso grande se pone al día en pocas horas.
* **Idempotente:** una segunda pasada sin vencimientos nuevos devuelve ceros y no cambia nada.
* **Convive con las cuotas de R3:** actualizar o borrar nunca choca con un tope (una cuenta por encima de su límite se purga igual).
* **«Deshacer» tras la purga:** `preview_undo_backup_import` responde que el plazo venció; si un «deshacer» ya iniciado alcanza a una corrida purgada, `apply_undo_backup_import` lo rechaza («ya renunciaste…») y **no** marca la corrida como deshecha en vacío. La pantalla ya mostraba «Ya no se conserva el detalle de la copia» y «el detalle necesario se eliminó con el tiempo».

### 3.3 Programación (pg_cron)

Migración `20261008120000_r4_schedule_import_purge.sql`: `create extension if not exists pg_cron` y dos trabajos idempotentes (`cron.schedule` por nombre): `tf-purge-expired-import-data` (cada hora, minuto 17, `select public.purge_expired_import_data(200)`) y `tf-cron-history-cleanup` (diario, borra el historial propio de pg_cron de más de 14 días). Si la base no tiene pg_cron (local, pruebas) **avisa y no falla**. **Costo: ninguno** (extensión incluida en Supabase).

## 4. Eliminación segura de cuenta y PDF (M-06)

### 4.1 Flujo (`lib/account/delete-account-flow.ts`)

1. La palabra «ELIMINAR» y la contraseña se validan **en el servidor**.
2. Se consume el límite `account_reauth` (10 por hora y por cuenta, en la base) **antes** de verificar la contraseña.
3. Se verifica la contraseña contra Supabase Auth (reautenticación, §5).
4. Se borran **todos** los PDF de la cuenta en Storage y se comprueba, con un listado nuevo, que no quede ninguno.
5. Recién entonces se llama a `delete_own_account` y se cierra la sesión.

Cualquier fallo en un paso deja los siguientes sin ejecutar y la cuenta intacta. Si falla el paso 5 después del 4, la cuenta sigue existiendo y los PDF se pueden volver a generar desde Reportes.

### 4.2 Cómo se borran los PDF

La base **no puede** borrar archivos de Storage con SQL (`storage.protect_delete`), y la cascada de `auth.users` no llega a Storage. Por eso lo hace la web con la **propia sesión** de la persona (las políticas del bucket sólo permiten borrar bajo `<id de usuario>/`): recorre el prefijo por la API de listado (`<owner>/<alumno>/<reporte>.pdf`, páginas de 100, carpetas con concurrencia 6), borra por lotes de 100 y hace una **comprobación final**. No se fía de la tabla `report_records`: así también se limpian archivos huérfanos de intentos anteriores.

* **Reanudable e idempotente:** borrar lo que no existe no falla; si se corta (tiempo máximo de 40 s dentro de los 60 s de la página, error de red o de Storage, un archivo que reapareció) lanza un error y la cuenta **no** se elimina; volver a intentar continúa donde quedó.
* **Seguro:** el prefijo sale del `ownerId` real de la sesión y debe ser exactamente un UUID (nunca vacío); cada ruta se valida bajo ese prefijo; no se borra nada de otra cuenta (probado con objetos de otra cuenta en el mismo bucket); los errores no incluyen rutas ni nombres.

### 4.3 Qué NO cubre (riesgo residual)

* **Eliminación desde la app móvil:** `delete_own_account` también la llama el móvil, que no sabe nada de Storage: una cuenta eliminada desde el móvil puede dejar sus PDF huérfanos. Arreglarlo exige tocar el código móvil o el RPC compartido, fuera del alcance. Se deja un **diagnóstico de sólo lectura** (`supabase/repairs/r4_orphan_report_pdfs.sql`, devuelve sólo cantidades): hoy 0 huérfanos. Borrarlos requiere la API de Storage con clave de servicio (decisión del dueño del proyecto).
* El RPC `delete_own_account` sigue sin pedir contraseña para quien lo llame directo con una sesión (también el móvil); lo que se endureció es el camino de la web.

## 5. Reautenticación para acciones críticas (M-06)

* **Diseño:** la contraseña se vuelve a verificar contra Supabase Auth **en la misma petición** de la acción crítica con un cliente aparte (sin cookies ni persistencia). Esa verificación crea una sesión nueva en Auth, que se descarta enseguida con alcance **local** (`signOut({ scope: "local" })`: jamás `global`, que cerraría todos los dispositivos). La sesión real no se toca.
* **Por qué sin «permiso reciente»:** no se guarda ninguna cookie ni bandera de «reautenticado hace N minutos» que se pueda robar o reutilizar; cada acción crítica vuelve a pedirla.
* **Límite de intentos:** `account_reauth` (10/h por cuenta, `consume_action_quota`, transaccional y por cuenta) cuenta aciertos y fallos; el límite por IP de Auth ve al servidor de Vercel (hallazgo de R3), por eso este tope es el que frena a alguien con una sesión robada.
* **CAPTCHA:** el diálogo lleva el widget de R3 (inerte mientras no haya clave de sitio) y manda el token a Auth si está activo.
* **Acciones críticas cubiertas:** eliminar la cuenta (contraseña). **Cambiar la contraseña** ya exige abrir un enlace o código del **correo** (reautenticación por correo), y ahora además el marcador firmado (§6): una sesión robada, sin el correo, no la puede cambiar. No se agregó una contraseña extra al simple envío del correo (no aporta seguridad y suma fricción).
* **Cuentas sin contraseña:** la web sólo ofrece correo y contraseña (el móvil no usa OAuth); no hay cuentas sin contraseña.

## 6. Marcador de recuperación firmado (L-06)

* **Formato:** `v1.<id de usuario>.<hora en ms>.<firma>` con `firma = base64url(HMAC-SHA256(secreto, "tf-recovery-marker|v1|<id>|<hora>"))`. Se compara en tiempo constante, **completa**, y después se controla usuario y vigencia (15 minutos, 1 minuto de desfase de reloj). El formato anterior (sin firma) **ya no vale**.
* **Qué impide:** quien tenga una sesión robada pero no haya verificado un enlace o código del correo no puede fabricar el marcador (necesitaría el secreto del servidor) y por lo tanto no entra a «Nueva contraseña» ni guarda una contraseña.
* **Secreto:** variable `RECOVERY_MARKER_SECRET` (sólo servidor, nunca `NEXT_PUBLIC_*`, 32+ caracteres, sin valores de ejemplo). **Production sin secreto = falla cerrado:** un enlace de recuperación verificado no deja marcador, la sesión que dejó el enlace se **cierra** y la persona ve un error controlado; ninguna cookie se acepta. En desarrollo y pruebas hay un valor local sin valor real. Nunca se imprime.
* **Rotación sin cortar recuperaciones en curso:** 1) pasar el valor actual a `RECOVERY_MARKER_SECRET_PREVIOUS`, 2) poner el nuevo en `RECOVERY_MARKER_SECRET`, 3) desplegar, 4) a los 15 minutos borrar `..._PREVIOUS`. El anterior sólo valida; siempre se firma con el vigente.
* **Efecto del despliegue:** una recuperación iniciada justo antes de desplegar necesita pedir un enlace nuevo (el marcador anterior ya no vale).

## 7. Evidencia

| Prueba | Resultado |
|---|---|
| Postgres 18.4 real, conexiones simultáneas — `r4_retention.cjs` | 50 comprobaciones: nada vigente se toca (corrida vigente, hora de gracia, 24 h de gracia); lo vencido se purga; idempotencia; lotes acotados; preview con corrida nunca se borra; **lock por cuenta** (una cuenta ocupada se salta mientras la otra se purga sin esperar, y se purga al liberarse); **dos purgas simultáneas** sin doble trabajo; «deshacer» después de la purga (plazo vencido / rechazo sin marcar deshecha); datos de negocio idénticos; privilegios (`anon`, `authenticated` y `service_role` reciben 42501); convive con las cuotas de R3; salida sólo numérica |
| Mutaciones SQL (`--mutations`) | cada control se rompe a propósito (sin gracia, sin filtro de vencimiento, sin lock, lock que espera, borrar previews con corrida, no borrar snapshots/payload/candidatos, lotes sin límite, privilegios abiertos…) y **todas** se detectan |
| Ensayo `r4_migration_rehearsal.cjs` (esquema real + datos sembrados, con importaciones vencidas y vigentes) | `BEGIN … ROLLBACK` con huellas idénticas; sólo 1 columna y 1 función nuevas; ninguna tabla, índice, constraint, disparador, política ni privilegio nuevo; reaplicar es idempotente; el web anterior sigue funcionando; la purga sólo cambia tablas de importación; el rollback manual deja el esquema idéntico al de antes de R4 |
| Ensayo contra **Production**, 100 % revertido (migraciones + `pg_cron` real + datos sintéticos) | extensión instalada y 2 trabajos programados dentro de la transacción; función sin `EXECUTE` para la API; purga real = ceros; purga sobre datos sintéticos correcta y segunda pasada = ceros; la 11.ª reautenticación con tope 10 rechazada. **Línea base de Production idéntica antes y después** (filas, huellas por tabla, funciones, índices, disparadores, políticas, extensiones, migraciones) |
| Pruebas web | marcador firmado (formato, firma completa, usuario, hora, vencimiento, desfase, otro secreto, rotación, sin secreto, configuración), recuperación sin secreto (enlace, código y PKCE: error controlado + sesión cerrada + sin marcador), sesión robada con marcador fabricado, flujo de eliminación (orden exacto, cada fallo deja la cuenta intacta, cuota antes de la contraseña, token de CAPTCHA, sin datos en mensajes), reautenticación, borrado de PDF con un Storage simulado (carpetas, >100 archivos y >100 carpetas, reanudable, archivo que reaparece, tiempo, prefijo inválido, otra cuenta intacta) y cableado de la acción y la pantalla |
| Mutaciones web | 55 rupturas a propósito (firma sin verificar, otro usuario, sin vencimiento, sin secreto, secreto corto, valor de desarrollo en Production, no cerrar sesión, no verificar contraseña, no borrar PDF, borrar la cuenta antes que los PDF, ignorar archivos pendientes, cierre de sesión global, bucket equivocado, etc.): **55/55 detectadas** (1 mutante equivalente descartado y documentado) |

## 8. Configuración manual y costos

| Qué | Estado | Costo |
|---|---|---|
| `pg_cron` | La migración lo instala si está disponible (lo está: 1.6.4) | Ninguno |
| `RECOVERY_MARKER_SECRET` en Vercel (Production) | Se define una vez, con un valor aleatorio generado, antes del despliegue (ver §11) | Ninguno |
| Rotar el secreto | Ver §6; sin urgencia | Ninguno |
| Servicios nuevos | Ninguno | — |

Siguen pendientes los controles externos de R3 (límites de Supabase Auth, CAPTCHA, regla del WAF de Vercel, cupo del SMTP); no cambian con R4.

## 9. Riesgo residual

1. **Eliminación desde el móvil** puede dejar PDF huérfanos y no pide contraseña (§4.3). Diagnóstico de sólo lectura incluido.
2. **Otras tablas con vencimiento** (`student_creation_claims`, `report_pdf_cleanup_jobs`, `pending_training_billing_operations`) siguen sin purga programada: están acotadas por los topes de R3. Es una ampliación natural de esta misma tarea programada, fuera del alcance pedido.
3. **Auth:** que «Secure password change» y «Confirm email» estén activos sigue sin poder verificarse sin el panel.
4. **`cloud_backups`** (respaldo de la app móvil): ya acotado a 10 copias por cuenta; fuera de alcance.
5. Una purga **no se puede deshacer** (es el objetivo): quien administre la base debe saber que, pasados 30 días, el respaldo importado ya no existe.

## 10. Rollback

* **Frenar la purga:** bloque A de `supabase/repairs/r4_retention_rollback.sql` (`cron.unschedule` de los dos trabajos). Es lo que hay que hacer ante cualquier duda; no cambia nada más.
* **Retirar todo:** A y luego B (función, acción de cuota `account_reauth` y columna `payload_purged_at`); después `supabase migration repair --status reverted 20261008100000 20261008110000 20261008120000`. Si se ejecuta B hay que volver a desplegar el web anterior a R4 (el diálogo de eliminar cuenta nuevo llama a `account_reauth`). El script está **probado** en el ensayo (deja el esquema idéntico al de antes de R4). Lo ya purgado no se recupera.
* **Web:** restaurar el deployment anterior de Vercel (R3, `dpl_FkzsE3xzahVcPSei2MGfyWBuJXhN`); es compatible con el esquema nuevo (verificado en el ensayo). No se revierten migraciones ni se borra `pg_cron`.
* **Secreto:** si se pierde o se filtra, cambiarlo (ver rotación) invalida los marcadores en curso (a lo sumo 15 minutos de recuperaciones).

## 11. Cierre en Production (7/oct/2026)

* **Migraciones** (un único `supabase db push`, sólo las tres que mostró el dry-run, con SHA-256 iguales a los del commit `517e1c9`): `20261008100000`, `20261008110000` y `20261008120000`. Antes se ensayaron **en Production, dentro de una transacción que abortaba al final** (migraciones + `pg_cron` real + datos sintéticos): la línea base quedó idéntica. Línea base de sólo lectura antes/después (huellas por tabla, funciones, índices, disparadores, políticas, políticas de Storage, límites de cuota, extensiones, migraciones; `cloud_backups` sólo cantidad e ids): migraciones 42 → 45 (45/45 `local=remote`); **ninguna tabla cambió** (23 tablas con filas, todas con la misma huella; 0 filas de importación, 0 PDF); y **sólo** cambió lo esperado: +1 columna (`import_previews.payload_purged_at`, nula), +1 función (95 → 96, ninguna existente modificada), +1 fila de configuración (`account_reauth`: 5 acciones), +1 extensión (`pg_cron` 1.6.4) y +2 trabajos programados activos. Índices, disparadores (120), políticas RLS (36), políticas de Storage y topes de R3 idénticos.
* **Verificación en Production:** `purge_expired_import_data` sin `EXECUTE` para `anon`, `authenticated` ni `service_role`; `SECURITY DEFINER` con `search_path` vacío; trabajos `tf-purge-expired-import-data` (`17 * * * *`) y `tf-cron-history-cleanup` (`43 3 * * *`) activos; diagnóstico de PDF huérfanos: 0 objetos.
* **Primera ejecución programada real de la purga (14:17 UTC):** **cron instalado y activo; primera ejecución natural pendiente de observación.** No se esperó: se verificó en su lugar que el trabajo existe (id 1, base `postgres`, usuario `postgres`), está activo, con horario `17 * * * *` y el comando exacto `select public.purge_expired_import_data(200)` (y el de limpieza del historial, `43 3 * * *`), que la función ya pasó las pruebas con datos sintéticos, rollback e idempotencia, y una **ejecución manual controlada** sobre Production devolvió todo en 0 (no hay filas de importación) y dejó la línea base idéntica antes y después (huellas por tabla, funciones, índices, políticas, extensiones, migraciones): sin residuos y sin tocar datos reales.
* **Secreto de firma:** `RECOVERY_MARKER_SECRET` creado en Vercel (Production, tipo *Secret*/sensible) con un valor aleatorio de 48 bytes generado en el momento, **sin mostrarlo ni guardarlo en ningún archivo**. Se creó antes del despliegue.
* **Deploy:** push sin force `0c4efad..dbb4e39` (`517e1c9` base, `dbb4e39` web), deployment `dpl_8NiYrKe7rwa3Y5ZJBSMGm9MmRHkW` desde el worktree limpio, Ready, con los tres aliases (`teacherflowapp.com`, `teacherflow-web.vercel.app`, `teacherflow-web-teacherflow.vercel.app`). Rollback no necesario (anterior: `dpl_FkzsE3xzahVcPSei2MGfyWBuJXhN`).
* **Verificación del web nuevo:** rutas públicas 200 y privadas → `/login?next=…`; `/nueva-contrasena` sin sesión → `/login`; `/auth/callback` sin código → `link_invalid`; cabeceras de R1 presentes (nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY`, CSP Report-Only, HSTS); **CAPTCHA inerte** (0 referencias a Cloudflare en `/login`). Con la cuenta QA (sólo lectura): Inicio, Alumnos y Calendario cargan sin errores de consola; en Configuración se abrió «Eliminar cuenta» **sin enviarlo**: pide la palabra y la contraseña (`type="password"`, `autocomplete="current-password"`), el botón sigue deshabilitado hasta completar ambas y no hay widget de CAPTCHA. Los logs del deployment son sólo nivel `info` (rutas visitadas), sin errores ni avisos, sin PGRST, RPC inexistente, tokens, correos ni datos personales.
* **Qué NO se verificó en Production** (a propósito): eliminar una cuenta (ninguna se eliminó ni se ejecutó el borrado de PDF: no existe ningún PDF), una recuperación de contraseña completa con un correo real (requiere un buzón; cubierta por las pruebas de recuperación, con y sin secreto) y una purga sobre datos reales (no hay ninguno; cubierta por el ensayo sintético revertido y por las pruebas en Postgres real). Si quiere comprobar el marcador firmado de punta a punta: «Olvidé mi contraseña» con una cuenta de prueba cuyo correo pueda abrir; con el secreto bien cargado llega a «Elegí una contraseña nueva».
