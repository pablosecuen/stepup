# R3 — Cuotas, abuso y límites de uso

Objetivo: impedir que una cuenta, un script o cuentas descartables llenen la base, agoten correos o disparen costos, **sin bloquear a una profesora real**. Este documento reúne la auditoría (sólo lectura), las cuotas elegidas con su justificación, qué se controla en la base / la web / proveedores externos, la evidencia de concurrencia e idempotencia, la configuración manual pendiente y el abuso que sigue siendo posible.

## 1. Auditoría (sólo lectura, 6–7/oct/2026)

### 1.1 Conteos y crecimiento reales en Production

| Dato | Valor |
|---|---|
| Cuentas en Auth | 5 (1 con datos; 2 con sesión activa y respaldos) |
| Máximos por cuenta (la única con datos) | 6 alumnos · 12 clases (+13 integrantes) · 7 registros (+8 integrantes, 6 asistencias, 8 evaluaciones) · 6 series (3 activas, 8 integrantes) · 3 cargos · 2 pagos · 2 asignaciones · 10 cambios de estado · 1 nivel personalizado |
| Crecimiento | Primer alta 21/sep, último 22/sep; 6 alumnos y 12 clases en los últimos 30 días; 0 altas en las últimas 24 h; 1 clase futura programada |
| Pendientes / vencibles | 0 claims, 0 previews de importación, 0 reportes, 1 operación de facturación pendiente (sin vencimiento), 0 limpiezas de PDF |
| Respaldos en la nube | 20 filas en 2 cuentas (10 por cuenta, el tope de retención); tamaño máximo ≈ 251 KB |
| Sesiones activas | 2 filas (1 por cuenta, `user_id` único) |

Conclusión: el uso real es mínimo; cualquier tope razonable queda órdenes de magnitud por encima del uso actual.

### 1.2 Operaciones que crean recursos

* **Por la web (Server Actions):** alta de alumno (`create_student_with_operation`, claim idempotente), clases únicas y series (`create_calendar_lesson`, `create_recurrence_series`, `split_recurrence_this_and_future`, `apply_recurrence_participants_from_date`, reprogramar/cancelar), registros de clase (`start_lesson_registration`, `save_participant_registration`, `edit_completed_lesson_registration`), cobros (`ensure_monthly_charges`, `ensure_training_charges`, `sync_per_class_charge`, `configure_training_billing`, `register_payment`), reportes (`claim_report_draft`, inserción de `report_records`, PDF en Storage), importaciones (`preview_backup_import`, `apply_backup_import`, `preview_undo_backup_import`), niveles personalizados y sesión activa (`transfer_active_session`).
* **Alcanzable DIRECTO por PostgREST/RPC (sin pasar por la web)** — catálogo de Production: 27 RPC con `EXECUTE` para `authenticated` que insertan filas (13 `SECURITY DEFINER`), 24 tablas con `INSERT` directo para `authenticated` (RLS exige `owner_id = auth.uid()`), y `cloud_backups` sólo por la RPC `upload_cloud_backup` (no tiene política de INSERT). `anon` conserva el privilegio `INSERT` en 23 tablas pero RLS lo rechaza (sin `auth.uid()`); sólo `set_updated_at` es ejecutable por `anon`. **Por eso las cuotas viven en disparadores de tabla**, no en las RPC ni en la web: valen igual para un script directo.
* **Respaldos en la nube (`upload_cloud_backup`, código de la app móvil, no se toca):** ya está acotado por diseño — máx. 20 MB por respaldo, conserva sólo los 10 más recientes por cuenta, deduplica por checksum y exige un dispositivo autorizado (`active_sessions`). Techo por cuenta ≈ 200 MB. **Sesiones activas:** una fila por cuenta (clave única), acotada.
* **Operaciones pendientes que vencen:** `student_creation_claims` (30 min), `import_previews` e `import_undo_previews` (30 min), `report_pdf_cleanup_jobs`, `pending_training_billing_operations`. Hoy ningún proceso las limpia (pg_cron es R4): por eso los topes de «pendientes» cuentan sólo las **vigentes** (una fila vencida nunca bloquea a nadie) y cada tabla tiene además un tope total que acota lo acumulado hasta que R4 las limpie.

### 1.3 Límites de proveedores (qué se pudo comprobar)

| Proveedor | Qué dice la documentación oficial (consultada hoy) | Qué NO se pudo comprobar |
|---|---|---|
| **Supabase Auth** | Límites por IP con *token bucket* (ráfaga de hasta 30) en alta/ingreso/recuperación/reenvío; límite de correos por hora del PROYECTO (con el correo integrado es muy bajo; configurable con SMTP propio); personalizables en *Authentication › Rate Limits* o por la Management API. Soporta CAPTCHA (hCaptcha o Cloudflare Turnstile). | Los valores configurados en este proyecto (requiere el panel o un token de la Management API; no se usó ninguna credencial). |
| **Resend** (si es el SMTP) | Plan gratuito: 100 correos/día (día UTC) y 3.000/mes, compartidos por todos los correos de la cuenta. | Si el SMTP de Supabase es Resend (en Vercel existen `RESEND_*` que el código no usa) y qué plan hay. |
| **Vercel** | *WAF Rate Limiting* disponible en Hobby (1 regla por proyecto, ventana fija, clave IP/JA4; 1.000.000 de solicitudes permitidas incluidas y luego uso medido a USD 0,50 por millón) y en Pro (40 reglas). Acciones: Log, Deny, Challenge, 429. | El plan del proyecto de Vercel y si ya hay reglas. |

### 1.4 Hallazgo importante: el límite por IP de Supabase Auth ve al servidor, no a la usuaria

El login, el alta, la recuperación y el reenvío se hacen **desde el servidor de Vercel** (Server Actions). Supabase Auth limita «por IP», pero la IP que ve es la de salida de Vercel, no la de la persona: el límite por IP **no distingue personas** y un volumen alto de intentos pasando por la web puede agotar el cupo compartido y perjudicar a usuarias legítimas. Supabase documenta la solución (`Sb-Forwarded-For` con una **clave secreta** y activando *IP Address Forwarding*), pero introduciría en la web una clave privilegiada que hoy no existe (la web sólo usa la clave publicable). **No se implementó**: es una decisión del propietario (ver §6).

## 2. Límites legítimos de una profesora real

Caso extremo realista (cuenta grande): ~150 alumnos activos y ~600 acumulados en 15 años (nunca se borran), ~40 clases por semana (~2.100 por año), 10+ años de historia, un cierre mensual con un reporte por alumno y 1–2 importaciones en toda la vida de la cuenta. Todos los topes de abajo dejan un margen de 2,5x a 15x sobre ese caso.

## 3. Cuotas elegidas (valores por defecto, editables por cuenta)

Se aplican en la base (`quota_defaults` + `account_quota_overrides`), en la misma transacción que crea el recurso. Ver §4.

| Categoría | Tope total | Por hora | Tamaño máx. de fila | Justificación |
|---|---:|---:|---:|---|
| `students` | 2.000 | — | 256 KB | Profesora grande: ~600 alumnos en 15 años (activos + archivados, nunca se borran). Margen ≥ 3x. |
| `student_creation_claims` | 20.000 | 300 | 256 KB | Un claim por alta o reintento; ≈ alumnos x altas repetidas. 300/h cubre cargas manuales intensas (60/h) con margen. |
| `student_creation_claims_pending` | 50 | — | — | Altas "pendientes de confirmar duplicado" (vencen a los 30 min): una persona abre pocas a la vez. |
| `calendar_lessons` | 50.000 | — | 256 KB | ~2.000 clases materializadas por año x 10 años = 20.000; margen 2,5x. |
| `calendar_lessons_future` | 6.000 | — | — | Clases futuras programadas: ~2.100 por año completas; 6.000 ≈ 3 años por adelantado. |
| `calendar_lesson_participants` | 150.000 | — | 256 KB | Hasta ~3 integrantes promedio por clase en 50.000 clases. |
| `recurrence_rules` | 5.000 | — | 256 KB | Series activas, pausadas, terminadas y sucesoras por cambios: 100 series activas x ~10 versiones, con margen amplio. |
| `recurrence_rule_participants` | 20.000 | — | 256 KB | Integrantes de series: 5.000 series x ~4. |
| `recurrence_exceptions` | 100.000 | — | 256 KB | Una excepción por ocurrencia cancelada/reprogramada: ~20.000 en 10 años. |
| `lesson_registrations` | 100.000 | — | 256 KB | Un registro por clase dictada: ~21.000 en 10 años; incluye libres (ad-hoc). |
| `lesson_registration_students` | 200.000 | — | 256 KB | Un integrante por alumno y registro. |
| `lesson_registration_attendance` | 200.000 | — | 256 KB | Una asistencia por alumno y registro. |
| `lesson_registration_evaluations` | 200.000 | — | 256 KB | Una evaluación por alumno y registro. |
| `lesson_registration_homework_reviews` | 300.000 | — | 256 KB | Revisión de tareas por alumno y registro (puede haber varias por registro). |
| `lesson_registration_edit_history` | 100.000 | — | 1 MB | Una auditoría por edición de registro finalizado; snapshot de hasta 1 MB. |
| `payments` | 50.000 | — | 256 KB | ~150 alumnos x 12 pagos por año x 10 años = 18.000; margen ≈ 3x. |
| `payment_charges` | 50.000 | — | 256 KB | Un cargo por alumno y período (+ por clase/entrenamiento): ~20.000 en 10 años. |
| `payment_allocations` | 100.000 | — | 256 KB | Asignaciones pago-cargo (pagos parciales, varios cargos por pago). |
| `payment_adjustments` | 20.000 | — | 256 KB | Condonaciones/ajustes: raros. |
| `training_billing_agreements` | 1.000 | — | 256 KB | Acuerdos de cuota de entrenamiento: una profesora tiene pocos. |
| `pending_training_billing_operations` | 200 | — | 1 MB | Operaciones de facturación pendientes de reconciliar: normalmente 0-1. |
| `package_purchases` | 20.000 | — | 256 KB | Paquetes de clases (funcionalidad del móvil). |
| `package_credit_movements` | 100.000 | — | 256 KB | Movimientos de crédito de paquetes. |
| `first_month_proration_decisions` | 20.000 | — | 256 KB | Decisión por alumno/período inicial. |
| `monthly_amount_corrections` | 20.000 | — | 256 KB | Correcciones de importe mensual: raras. |
| `initial_paid_surcharge_corrections` | 20.000 | — | 256 KB | Correcciones de recargo inicial: raras. |
| `student_status_history` | 50.000 | — | 256 KB | Cambios de estado por alumno: ~600 alumnos x ~10 cambios x margen. |
| `student_level_history` | 50.000 | — | 256 KB | Cambios de nivel por alumno. |
| `student_price_history` | 50.000 | — | 256 KB | Cambios de precio por alumno. |
| `custom_levels` | 200 | — | 256 KB | Niveles personalizados: una profesora usa unos pocos. |
| `report_records` | 10.000 | 60 | 1,5 MB | Reportes: 150 alumnos x 12 por año x 10 años = 18.000 máx. teórico; 10.000 deja margen real. 60/h: cada reporte renderiza un PDF. |
| `report_pdf_cleanup_jobs` | 5.000 | — | 256 KB | Limpiezas de PDF pendientes (se resuelven solas): normalmente 0. |
| `import_previews` | 2.000 | 20 | 40 MB | Vistas previas de importación (cada una guarda el respaldo normalizado, hasta 40 MB). 20/h es mucho más que el uso real. |
| `import_previews_pending` | 10 | — | — | Vistas previas vigentes (vencen a los 30 min): una o dos a la vez en la práctica. |
| `import_runs` | 500 | — | 40 MB | Importaciones aplicadas: eventos raros (alta inicial, recuperación). |
| `import_undo_previews` | 1.000 | — | 8 MB | Vistas previas de deshacer importación. |
| `import_undo_previews_pending` | 10 | — | — | Vistas previas de deshacer vigentes. |

| Acción | Máximo por ventana | Ventana | Justificación |
|---|---:|---:|---|
| `report_preview` | 120 | 1 h | Vista previa de reporte: cálculo sobre el historial del alumno; una profesora previsualiza pocas veces por alumno. |
| `report_pdf` | 60 | 1 h | Generar o regenerar un PDF (CPU del servidor): 150 alumnos en un cierre mensual = 150/mes, no por hora. |
| `cloud_backup_analyze` | 20 | 1 h | Descarga y análisis del respaldo de la nube (hasta 20 MB): uso real ≈ 1-2 por importación. |
| `password_change_email` | 5 | 1 h | Correo de cambio de contraseña de una sesión iniciada (consume cuota de correos del proveedor). |

Reglas:
* **Una cuenta que ya supera un límite nuevo nunca queda bloqueada por lo que ya tiene**: sólo no puede crear MÁS filas de esa categoría; puede leer, editar y crear en las demás. Un `UPDATE` sólo se rechaza si agranda una fila por encima del tope de tamaño.
* **Los reintentos idempotentes no consumen cuota**: los topes se comprueban con un disparador `AFTER INSERT` por sentencia, que no se dispara para las filas que `ON CONFLICT DO NOTHING` descarta ni para las RPC que reconocen una clave de operación ya usada.
* **Excepciones por cuenta, sin API pública**: `account_quota_overrides(owner_id, quota_key, max_total, max_per_hour, max_row_bytes)` (un valor nulo hereda el defecto; para las acciones de la web la clave es `action:<acción>` y el valor va en `max_total`). RLS activa sin políticas y sin permisos para `anon`/`authenticated`: se edita únicamente con SQL privilegiado (SQL Editor / `supabase db query`). Ejemplo: `insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ('<uuid>', 'students', 5000) on conflict (owner_id, quota_key) do update set max_total = excluded.max_total;`
* **Errores seguros**: la base devuelve SQLSTATE `53400` con `quota_exceeded` / `quota_rate_exceeded` / `quota_row_too_large` y la categoría en `details`; la web los traduce a un texto por rubro («Alcanzaste el límite de alumnos de tu cuenta. Si necesitás más espacio, escribinos y lo revisamos.») sin tablas, SQL ni cifras.

## 4. Dónde se controla cada cosa

| Capa | Control | Estado |
|---|---|---|
| **Base (Postgres)** | Topes totales, por hora y de «pendientes vigentes» por cuenta y categoría; tamaño máximo de fila; límite por ventana de acciones costosas (`consume_action_quota`) | **Implementado y probado** (esta etapa) |
| **Web (Server Actions)** | Pide la cuota por ventana ANTES del trabajo costoso: vista previa de reporte (120/h), generar o regenerar PDF (60/h), analizar el respaldo de la nube (20/h), correo de cambio de contraseña (5/h); traduce los errores de cuota | **Implementado y probado** |
| **Web (formularios públicos)** | Widget Turnstile y reenvío del token a Supabase | **Preparado y DESACTIVADO** hasta configurar claves (§5) |
| **Supabase Auth** | Límite por IP y por usuario en alta/ingreso/recuperación/reenvío, límite de correos por hora, CAPTCHA, confirmación de correo obligatoria | **Externo: requiere configuración manual** (§6) |
| **Proveedor de correo (Resend/SMTP)** | Cuota diaria/mensual de correos | **Externo** (§6) |
| **Vercel Firewall (WAF)** | Límite de solicitudes por IP a las rutas públicas y a las Server Actions | **Externo** (§6) |

Por qué NO hay un límite en memoria dentro de Vercel: cada instancia tiene su propio contador y las instancias nacen y mueren; el límite sería falso. El límite por ventana es **transaccional en Postgres** (lock por cuenta y acción), idéntico para todas las instancias. No registra IP, correo, token ni datos personales (sólo `owner_id`, nombre de la acción y la hora).

## 5. CAPTCHA (Cloudflare Turnstile) — preparado, desactivado

Supabase Auth soporta hCaptcha y Cloudflare Turnstile («Authentication › Bot and Abuse Protection › Enable CAPTCHA protection») y exige el token en `options.captchaToken` de `signUp`, `signInWithPassword`, `resetPasswordForEmail` y `resend`. Se eligió Turnstile (gratuito).

Código (inerte sin clave): `lib/auth/captcha.ts`, `components/auth/captcha-widget.tsx`, los 4 formularios públicos y el botón «Cambiar contraseña». **Sin `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no se renderiza nada, no se carga ningún script de terceros y no se manda ningún token** (verificado con un build sin la variable: 0 widgets, 0 referencias a Cloudflare, política `frame-src 'none'` sin cambios). Con una clave de sitio válida: widget visible, origen de Turnstile permitido sólo en la política de PRUEBA (`Content-Security-Policy-Report-Only`; `frame-ancestors 'none'` sigue bloqueante), token validado en el servidor (forma, ≤ 2048 caracteres) y reenviado a Supabase.

**Qué hay que configurar a mano, en este ORDEN** (invertirlo rompe todos los ingresos):
1. En Cloudflare (cuenta gratuita) › Turnstile: crear un sitio para `teacherflowapp.com`; copiar la **clave de sitio** y la **clave secreta**.
2. En Vercel › Environment Variables (Production): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = clave de sitio (pública). **No** cargar la clave secreta en Vercel. Desplegar.
3. Comprobar en Production que `/login`, `/crear-cuenta` y `/recuperar-contrasena` muestran el widget y que se puede ingresar.
4. **Recién entonces**, en Supabase › Authentication › Bot and Abuse Protection: activar CAPTCHA, elegir Turnstile y pegar la **clave secreta**.
5. Si algo falla: desactivar CAPTCHA en Supabase (vuelve a funcionar sin token) y/o quitar la variable de Vercel.

## 6. Configuración manual pendiente y costos

| Dónde | Qué hacer | Costo / plan |
|---|---|---|
| **Supabase › Authentication › Rate Limits** | Revisar y ajustar: correos enviados por hora, altas/ingresos por IP por 5 min, verificaciones. Punto de partida sugerido para una escuela pequeña: correos 20–30/h, altas e ingresos por IP 30/5 min (el defecto) | Incluido en el plan actual |
| **Supabase › Authentication › Providers › Email** | Confirmar que «Confirm email» está activo (el alta ya lo asume) y que «Secure password change» está activo | Incluido |
| **Supabase › Auth › Rate Limits › IP Address Forwarding** (opcional, decisión del propietario) | Hace que el límite por IP vea a la persona y no a Vercel; exige una clave secreta `sb_secret_…` en el servidor (hoy la web NO tiene ninguna) y un cliente aparte sólo para los endpoints públicos | Incluido; el riesgo es introducir una clave privilegiada |
| **Cloudflare Turnstile + Supabase CAPTCHA** | §5 | Gratuito |
| **Vercel › Firewall › Rate Limiting** | Una regla (Hobby permite 1) con ventana fija de 60 s por IP, p. ej. 60 solicitudes/min sobre `/login`, `/crear-cuenta`, `/recuperar-contrasena` y los `POST` de Server Actions; empezar en modo **Log** y luego **Challenge/429** | Hobby: 1 regla y 1.000.000 de solicitudes permitidas incluidas, luego USD 0,50 por millón; Pro: 40 reglas. **Verificar el plan** |
| **Proveedor de correo** | Si el SMTP es Resend: plan gratuito 100/día y 3.000/mes; con una cuenta nueva por correo de alta/recuperación, un atacante puede consumir el cupo diario completo → el límite por hora de Supabase debería quedar por debajo de 100/día (≈ 4/h sostenidas) si no se paga un plan | Plan pago de Resend sólo si hace falta más volumen |
| **Supabase › Spend cap / disco** | Mantener el *spend cap* y las alertas de uso activos | Según el plan |

## 7. Evidencia

* **Postgres real** (PostgreSQL 18.4 vía `embedded-postgres`, con las 40 migraciones reales y varias conexiones simultáneas; `supabase/tests/postgres/r3_quotas.cjs`): **88 comprobaciones**: límite −1 / exacto / +1; INSERT directo como `authenticated`; RPC `create_student_with_operation` en el tope; **rollback completo** (huellas idénticas, cero claims huérfanos); **reintento con la misma clave de idempotencia en el tope: mismo alumno, sin consumir ni fallar**; clave nueva en el tope: rechazada; `ensure_monthly_charges` repetido en el tope (`ON CONFLICT DO NOTHING`): 0 nuevos y sin error, con un candidato nuevo: rechazado y revertido; una categoría agotada no afecta lecturas, ediciones ni otras categorías; cuenta por encima de un límite nuevo: conserva, lee y edita y crea en otras categorías; niveles: al borrar uno se libera la cuota; **dos conexiones por la última unidad: exactamente una entra**; **8 conexiones por 3 lugares: 3 entran y 5 reciben cuota**; dos propietarias en paralelo sin compartir contadores ni bloquearse (A tardó < 700 ms mientras B retenía su transacción 1,8 s); claims pendientes vigentes vs. vencidos; clases futuras (una pasada entra con el tope de futuras lleno); límite por hora de reportes; tamaño de fila (3 MB rechazado, 400 KB entra, un `UPDATE` que no agranda una fila vieja pasa y uno que la agranda no); acciones costosas por ventana (la 4ª falla, un rechazo no infla la tabla, otra cuenta u otra acción son independientes, la ventana se libera y limpia sola, 6 conexiones por 3 unidades: 3 y 3); `anon` y usuaria sin sesión; las 4 tablas de configuración ilegibles e inescribibles para `anon`/`authenticated`; funciones sin `EXECUTE` para la API y con `search_path` vacío; configuración coherente (cada clave de los disparadores tiene su valor por defecto, 33 tablas, todas con `owner_id`).
* **Mutaciones** (rompen un control y la prueba debe fallar): **14/14 detectadas en SQL** (sin lock, límite +1, límite −1, sin filtro de propietaria, lock compartido entre cuentas, sin override, sin filtro de categoría, sin tope por hora, tamaño ignorado, `UPDATE` bloquea filas viejas, acción sin ventana / sin lock / sin limpiar vencidos, disparador BEFORE que rompe los reintentos idempotentes) y **21/21 detectadas en TypeScript**.
* **Ensayo BEGIN … ROLLBACK** sobre el esquema real con datos (`r3_migration_rehearsal.cjs`): huellas de las tablas de datos idénticas antes / dentro / después y tras reaplicar; nada eliminado; ninguna política RLS cambiada; sólo 4 tablas, 5 funciones y 66 disparadores nuevos; reaplicar es idempotente; el uso normal del web anterior sigue funcionando con los disparadores puestos; el script de rollback deja el esquema como estaba.
* **Costo de los disparadores** (medido): 40.000 pagos en una sentencia: 3,2 s sin cuotas → 3,3 s con el conteo (+2 %) y 4,1 s con conteo + tamaño de fila (+25 %); un `INSERT` suelto con 40.000 filas existentes cuesta ≈ 5 ms más (el `count`).
* **Web:** suite completa **1010/1010** (+24 pruebas), `tsc`, `eslint` y `next build` en verde; CAPTCHA inerte sin clave y activo con una clave de prueba (sólo local).

## 8. Abuso que sigue siendo posible (honestamente)

1. **Cuentas descartables en masa y correos de alta/recuperación**: dependen de los límites de Supabase Auth, del CAPTCHA y de Vercel WAF (§6), que requieren configuración manual; hasta hacerla, siguen como estaban.
2. **La función de borde `generate-student-report` (app móvil, no está en este repo)** — hallazgo previo de la auditoría: sin verificación de usuario propia, `Access-Control-Allow-Origin: *`, sin límite de entrada ni de frecuencia, llama a la API de Anthropic con una clave del proyecto. Es el vector de **costo** más serio que queda; corregirlo exige tocar el código móvil/la función (fuera del alcance de R3).
3. **Almacenamiento por cuenta**: los topes son por cantidad de filas y por tamaño de fila; el techo teórico por cuenta sigue siendo de cientos de MB a pocos GB si alguien se propusiera llenarlo (p. ej. 100 vistas previas de importación de 25 MB). No hay un tope de bytes totales por cuenta.
4. **Filas vencidas sin limpiar**: claims, previews y limpiezas de PDF vencidos se acumulan hasta R4 (pg_cron); están acotados por los topes totales.
5. **`cloud_backups`**: acotado (10 × 20 MB por cuenta), pero cada subida puede escribir hasta 20 MB sin límite de frecuencia (código móvil, no tocado).
6. **Denegación contra otra cuenta**: un atacante autenticado sólo puede agotar SUS propios topes; no hay forma de consumir los de otra cuenta (probado).
7. **Límite por IP de Supabase Auth visto desde el servidor de Vercel** (§1.4).

## 9. Plan de rollback

* **Base**: las migraciones son aditivas. `supabase/repairs/r3_quotas_rollback.sql` (NO es una migración): el bloque A quita los 66 disparadores (los límites dejan de aplicarse al instante; la configuración queda); el bloque B además elimina las 5 funciones y las 4 tablas de configuración. Ensayado: deja el esquema idéntico al de antes de R3 sin tocar ningún dato de la aplicación. No se ejecuta automáticamente; si se ejecuta B hay que volver a desplegar el web anterior (el nuevo llama a `consume_action_quota`).
* **Web**: restaurar el deployment anterior. El web anterior es compatible con el esquema nuevo (los límites sólo agregan rechazos 53400, que el web anterior muestra como error genérico).
* **CAPTCHA**: quitar `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y/o desactivarlo en Supabase.
* **Una cuenta bloqueada por error**: subir su límite con `account_quota_overrides` (§3); no hace falta desplegar nada.

## 10. Cierre en Production (7/oct/2026)

* **Migraciones** (autorizadas en el encargo de R3; un único `supabase db push`, sólo las dos que mostró el dry-run, con contenido y SHA-256 iguales al commit `9e8f65e`): `20261007100000` y `20261007110000`. Línea base de sólo lectura antes/después (conteos y huellas md5; `cloud_backups` sólo cantidad): migraciones 40 → 42 (42/42 `local=remote`); **ninguna tabla existente cambió** (44 tablas, 175 filas, mismas huellas); tablas 44 → 48 (sólo las 4 de configuración); funciones +5 y ninguna modificada ni eliminada; índices +4 (claves primarias de las tablas nuevas y su índice) sin tocar ninguno; disparadores públicos 54 → 120 (+66 = 33 tablas x 2); políticas RLS idénticas.
* **Verificación en Production:** las 4 tablas de configuración con RLS y sin `SELECT`/`INSERT` para `anon` ni `authenticated`; `anon` y `authenticated` reciben `42501` al leer/escribirlas; `consume_action_quota`: `SECURITY DEFINER`, `search_path` vacío, `EXECUTE` sólo para `authenticated` (`anon` → `42501`, sin sesión → `28000`); las otras 4 funciones sin `EXECUTE` para la API; 37 categorías y 4 acciones cargadas; 33 tablas con disparador de conteo y 33 con tamaño de fila.
* **Prueba sintética 100 % revertida** (un bloque `DO` que termina en `RAISE EXCEPTION`, con una cuenta sintética `@invalid.test` que no sobrevive): límite exacto (2 de 2), reintento con la misma clave en el tope = mismo alumno sin consumir, INSERT directo y RPC con clave nueva en el tope = `quota_exceeded` (y 0 claims residuales del rechazo), otra categoría no afectada, acción por ventana: la 3ª con tope 2 = `quota_rate_exceeded`. **Conteos antes/después idénticos** (5 cuentas, 6 alumnos, 0 claims, 1 nivel, 0 eventos, 0 overrides). No se fuerza ninguna cuenta real hasta el límite.
* **Compatibilidad:** con las migraciones aplicadas y todavía el web de R2 desplegado, Inicio y Alumnos cargaron bien con la sesión QA.
* **Deploy:** push sin force `431fc1b..a1732bb` (incluye `9e8f65e`), deployment `dpl_FkzsE3xzahVcPSei2MGfyWBuJXhN` desde el worktree limpio, Ready, con los tres aliases (`teacherflowapp.com`, `teacherflow-web.vercel.app`, `teacherflow-web-teacherflow.vercel.app`). Rollback no necesario (anterior: `dpl_Hb6sjjRqitFcd8cbWNRjgYmetxVs`).
* **Verificación del web nuevo:** cabeceras de R1 en 7 rutas (nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, CSP Report-Only con `frame-src 'none'`, sin `X-Powered-By`); rutas públicas 200 y privadas → `/login?next=…`; **CAPTCHA inerte en Production** (0 widgets y 0 referencias a Cloudflare en `/login`); con la cuenta QA (sólo lectura) Inicio carga estable (0 redirecciones, sin B0), Alumnos y Calendario cargan sin errores; los logs del deployment (12 solicitudes únicas: 9 × 200 y 3 × 307) no tienen avisos ni errores ni líneas de la aplicación, ni PGRST, RPC inexistente, timeouts, URLs largas, correos ni tokens. No se abrieron las pantallas que disparan acciones costosas (reportes, importación, cambio de contraseña).
* **Qué NO se verificó en Production** (a propósito): el texto de un límite alcanzado en la interfaz (cubierto por pruebas unitarias y por el rechazo real de la base en la prueba revertida), el widget de Turnstile con una clave real, y cualquier configuración externa del §6.
