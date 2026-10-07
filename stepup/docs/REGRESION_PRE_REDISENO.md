# Regresión final previa al rediseño (R1–R8)

Parte de `018f09e` (R8 cerrado). **No se implementó ninguna mejora ni se cambió el diseño; no hubo defectos reales de producto, así que no hubo cambios de código ni deploy.** Sólo se agregaron guiones de prueba (`supabase/tests/regression/`) y este documento. Fecha: 7/oct/2026.

Método: **cuentas sintéticas** (`@example.invalid`, creadas y borradas en la misma corrida; nunca la cuenta real de la profesora) contra **Production**, usando el **código real de los repositorios de la web** con **supabase-js 2.117.3**, huellas de las 48 tablas antes y después, y logs de Vercel. No se escribió ninguna contraseña en un formulario ni se activó el CAPTCHA de Supabase; el alta y la recuperación usaron enlaces generados por la API de administración (**cero correos enviados**).

## 1. Matriz de pruebas y resultados

**Resultado: 63/63 (flujos) + 16/16 (páginas) = 79/79.** Corrida completa del guion principal: 63/63 (una primera corrida dio 61/63 por **dos errores del propio guion**, ya corregidos y repetida completa: «8 caracteres» contaba 10 y esperaba mal la rotación; ver §2).

| # | Área | Prueba | Resultado |
|---|---|---|---|
| 1 | Autenticación | Alta con contraseña de 7 caracteres: rechazada (`weak_password`), sin crear usuario ni enviar correo | ✓ |
| 1 | | Alta con 8+ caracteres: el usuario nace sin confirmar; **antes de confirmar no se puede iniciar sesión**; confirmación por `verifyOtp` crea sesión y confirma | ✓ |
| 1 | | Login correcto / contraseña incorrecta (`invalid_credentials`) | ✓ |
| 1 | | Recuperación: enlace → sesión; cambio a 7 caracteres rechazado; a **8 exactos** y a 8+ aceptado (con cambio seguro activo); la anterior deja de servir; la nueva inicia sesión | ✓ |
| 1 | | **Refresco con supabase-js 2.117.3:** tokens nuevos del mismo usuario | ✓ |
| 1 | | **Dos pestañas** (dos clientes con el mismo almacenamiento) con la sesión vencida refrescando a la vez: las dos siguen con sesión, mismo usuario, sin errores | ✓ |
| 1 | | Dos refrescos simultáneos con el mismo refresh token (dentro del intervalo de reuso): ambos 200 | ✓ |
| 1 | | Rotación: cada refresco entrega un token nuevo; el de **dos generaciones atrás** se rechaza (400 `refresh_token_already_used`) | ✓ |
| 1 | | Dos cuentas en paralelo: cada sesión ve su usuario (sin cruces) | ✓ |
| 1 | | **Servidor de Production, dos pestañas:** 3 solicitudes simultáneas (`/inicio`, `/alumnos`, `/inicio`) con el access token del cookie vencido: las 3 responden 200 autenticadas y renuevan el cookie, sin redirigir a `/login` | ✓ |
| 2 | Alumnos | Crear un alumno con una operación sintética (`create_student_with_operation`) | ✓ |
| 2 | | Recarga (misma operación): mismo alumno, `replayed = true`; doble envío simultáneo: converge en uno; respuesta perdida y reintento: mismo alumno; total 2 | ✓ |
| 2 | | **Posible duplicado:** se advierte (candidato con señal «nombre») y **no se crea nada**; «Es otra persona» lo crea; reenviar la confirmación no crea otro | ✓ |
| 2 | | Aislamiento: la misma clave de operación en otra cuenta crea su propio alumno; la otra cuenta no lee alumnos ajenos (RLS); alumno sin nombre se rechaza antes de escribir | ✓ |
| 3 | Calendario | Crear una serie sintética con 2 participantes (idempotente por operación) | ✓ |
| 3 | | **«Esta y las siguientes»:** original con `end_date = 2026-11-15` (día anterior a la fecha efectiva) y activa hasta entonces; apunta a la sucesora; la sucesora apunta a la original, rige desde `2026-11-16`, sin fin, con las semanas nuevas; la original conserva las suyas | ✓ |
| 3 | | Participantes: la original conserva los 2 y la sucesora recibe los mismos 2; no queda ninguna clase materializada huérfana; repetir el split no crea una segunda sucesora; la web lista las 2 series | ✓ |
| 3 | | **R8:** un payload viejo con sólo `endDate` se rechaza (22023) sin escribir | ✓ |
| 4 | Importación R6.1 | Cuenta QA **aislada** (la copia sintética en `cloud_backups` y un presupuesto 50/30/20 y un nivel «Nivel A» sembrados): la web lee su copia, la valida y la analiza | ✓ |
| 4 | | Cadena **acuerdo → serie → clase → registro → asistencia/tarea/cobro**, dos veces: **todas** las series, clases, registros y cobros son importables | ✓ |
| 4 | | **Niveles repetidos:** 2 duplicados informados (contra la web y dentro de la copia), sólo «Nivel B» se agrega; **presupuesto** 40/40/20 aparece como diferencia a decidir | ✓ |
| 4 | | Confirmación: 6 alumnos, 4 acuerdos, 6 series, 8 clases, 6 registros, 4 cobros, 2 pagos, 6 asistencias…; cada clase de serie unida a su serie; presupuesto aplicado de una vez (suma 100) | ✓ |
| 4 | | Respuesta perdida / reintento: misma corrida, cero escrituras; **deshacer** seguro y completo; reintento del deshacer repetido | ✓ |
| 4 | | **Sin residuos tras deshacer:** las 17 tablas de la cadena en 0, presupuesto de vuelta en 50/30/20, el nivel agregado desaparece | ✓ |
| 4 | | Revisión vencida: rechazada, sin escribir; presupuesto parcial que no suma 100: rechazado con su mensaje, sin escribir | ✓ |
| 5 | Production | Con una sesión sintética por cookies (formato de la web): `/inicio`, `/alumnos` (con el alumno sintético), `/calendario`, `/cobros`, `/registro`, `/configuracion`, `/configuracion/respaldo`, `/resumen-financiero`, `/recordatorios`, `/alumnos/nuevo`: **200 y sin textos de error** | ✓ |
| 5 | | Sin sesión una página protegida redirige a `/login`; cabeceras (HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`); cookie de sesión `HttpOnly`, `Secure`, `SameSite=Lax` | ✓ |

## 2. Hallazgos de la propia regresión (ningún defecto de producto)

* **Rotación de refresh tokens — aclaración del comportamiento.** El servidor tolera reusar **el token inmediatamente anterior** (el cliente pudo perder la respuesta): sigue dando 200 aunque pase el intervalo. Un token de **dos generaciones atrás** sí se rechaza (400 `refresh_token_already_used`), pero el token activo **sigue sirviendo** (esta versión de Supabase no revoca la familia entera). `docs/R7_CONTROLES_EXTERNOS.md` decía «invalida la familia»: se corrigió esa frase. No es un defecto de la web ni requiere cambios.
* Dos expectativas del guion estaban mal (contraseña de «8» con 10 caracteres y la prueba de rotación); se corrigieron y se repitió la corrida completa.

## 3. Cambios realizados

Ninguno en la aplicación ni en la base. Agregados: `supabase/tests/regression/` (guiones reutilizables y su README) y este documento; una corrección de redacción en el documento de R7. **Sin deploy** (nada que desplegar).

## 4. Evidencia de limpieza

* Al terminar cada corrida el `finally` borra las cuentas sintéticas (`auth.admin.deleteUser`, cascada) y verifica que ya no figuran. Comprobación posterior en Production (sólo lectura): **0 usuarios `r8reg-…@example.invalid`**, 0 filas de negocio huérfanas en cualquier tabla con `owner_id`, 0 copias en la nube y 0 sesiones activas huérfanas; `auth.users` quedó en 5 (las cuentas reales de antes).
* **Huellas por tabla antes/después de TODA la regresión (conteo + md5 de cada fila): las 48 tablas idénticas** (217 filas). En la línea base completa (RLS, políticas, privilegios, cuerpos y privilegios de funciones, índices, disparadores, `pg_cron`…) la única diferencia es `cron_ejecuciones` (el trabajo programado de purga corre cada hora por sí solo). Los datos reales no cambiaron.

## 5. Estado de Production y logs

* Última versión desplegada: `dpl_E6gofhxGbXaY754gZtYqCxpwJmkM` (R8), `Ready`; migraciones 54/54; las 3 reglas del Firewall en modo Log siguen publicadas; SSL de la base impuesto; Auth con mínimo de 8 y cambio seguro de contraseña.
* **Logs de ejecución de las últimas 2 horas** (que incluyen toda la regresión): 44 entradas, todas de nivel `info` (28 × 200, 6 × 307 redirecciones, 8 de bloqueos de la plataforma, 2 × 404 de exploradores); **0 errores, 0 `PGRST`, 0 `JWT`, 0 correos y 0 tokens**; sin bucles de redirección (los 307 son los de «sin sesión → `/login`»).
* **Consola del navegador:** en R7/R8 las pantallas Inicio, Alumnos y Respaldo cargaron con la sesión real sin errores de consola. En esta ronda el panel del navegador **se reinició y perdió la sesión real** (una interrupción del panel, no un cierre del servidor: las huellas de `active_sessions` y de todas las tablas no cambiaron) y **no se inicia sesión desde acá**: por eso las páginas se verificaron con una sesión sintética por cookies (§1, fila 5) y los logs de la plataforma.

## 6. Limitaciones manuales restantes

1. **Pantalla «Revisar y decidir» del asistente de importación** (niveles repetidos y distribución 50/30/20 como una sola decisión): sólo se probó la lógica de datos, el mapeo y las pruebas de la pantalla; hay que mirarla una vez con una copia real o QA en un navegador autenticado.
2. **Dos pestañas reales con la sesión de la profesora:** se probó el refresco concurrente (cliente y servidor) con sesiones sintéticas; falta verlo en un navegador real durante una hora de uso.
3. **Cruce web ↔ móvil:** nada de esta regresión toca la app móvil (ver §7).
4. **Pendientes de R7** (Turnstile, Spend Management, integración de Resend, visibilidad del repositorio, DMARC `rua`, panel de Resend): siguen igual y no bloquean el rediseño.
5. **Datos reales de la profesora:** la importación de su copia real sigue sin ejecutarse (a propósito).

## 7. Pruebas manuales pendientes en Expo Go (app móvil; sin cambios acá, CAPTCHA de Supabase sigue APAGADO)

Con una cuenta de prueba nueva (no la real):
1. **Alta:** correo + contraseña de **7 caracteres** → debe mostrar el rechazo; con **8+** → pide confirmar el correo.
2. **Confirmación:** abrir el enlace del correo (deep link `teacherflow://auth-confirmed`) → entra a la app.
3. **Login:** correcto, y con contraseña equivocada → mensaje de error sin cerrar nada.
4. **Recuperación:** «Olvidé mi contraseña» → enlace (`teacherflow://reset-password`) → nueva contraseña de 7 caracteres rechazada y de 8+ aceptada (con el cambio seguro activo) → vuelve a iniciar sesión.
5. **Sesión:** dejar la app abierta más de una hora o reabrirla al día siguiente → sigue autenticada (refresco) y la copia en la nube sigue subiendo; probar el cambio de dispositivo (otra sesión activa) si aplica.
6. **Importante:** confirmar que **ninguna** de estas pantallas pide un CAPTCHA.

## 8. Veredicto

**LISTA para el rediseño.** 79/79 comprobaciones, cero defectos de producto, los datos reales intactos (48 tablas idénticas), Production y logs sin errores. Las limitaciones de §6 son verificaciones visuales o manuales que no bloquean el trabajo de diseño; conviene repasar la pantalla de importación (punto 1) cuando se rediseñe esa zona.
