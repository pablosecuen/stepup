# R7 — Controles externos (Supabase, Vercel, GitHub, correo, costos)

Cierra lo que se pueda de §9 de la auditoría defensiva (`auditoria-2026-10-06/INFORME.md`): los controles que **no viven en el código** sino en los paneles de los proveedores. Parte de `8186e43` (R6.1 cerrado). Este documento está separado del resto a propósito. Fecha: 7/oct/2026.

Cada control tiene exactamente uno de estos estados:

* **Aplicado** — se cambió en esta ronda (y se dice cuál era el valor anterior).
* **Verificado** — se leyó el valor real y ya era correcto (o se probó).
* **Pendiente por credenciales o panel** — hace falta algo que no se puede hacer desde acá.
* **No aplicable** — no corresponde o no conviene.
* **Requiere decisión económica** — la decisión es de plata, no técnica.

Qué **no** se hizo, a propósito: no se tocó la visibilidad del repositorio, ningún dominio ni alias, el plan de ningún servicio, ni se enviaron correos de prueba. Las pruebas contra Production usaron un usuario sintético (`@example.invalid`) creado y borrado en la misma corrida, sin correos.

## 1. Resumen

| Control | Estado |
|---|---|
| Supabase: Edge Functions | **Verificado** — hay 0 desplegadas |
| Supabase Auth: confirmación de correo | **Verificado** — obligatoria |
| Supabase Auth: cambio seguro de contraseña | **Aplicado** (estaba apagado) y **Verificado** con una prueba sintética |
| Supabase Auth: rotación de refresh tokens | **Verificado** — activa, intervalo de reuso 10 s |
| Supabase Auth: política de contraseña | **Aplicado** — mínimo 8 (era 6; la web y la app móvil ya exigían 8). Requisitos de complejidad: **requiere decisión de producto** |
| Supabase Auth: confirmación doble al cambiar el correo | **Aplicado** (estaba apagado; ningún cliente cambia el correo, es sólo endurecimiento) |
| Supabase: imposición de SSL de la base | **Aplicado** y **Verificado** (CLI, deploy y Production siguen bien) |
| Supabase: restricción de red de la base (0.0.0.0/0) | **No aplicable** — se deja abierta (§3.5) |
| Supabase Auth: límites por IP | **Verificado**, sin cambios (§3.6) |
| CAPTCHA (Turnstile + Supabase) | **Pendiente por credenciales** y **bloqueado por la app móvil** (§4) — no se activó nada |
| Vercel: reglas del Firewall para inicio de sesión, alta y recuperación | **Aplicado** en modo **Log** (§5) |
| Vercel: plan | **Verificado** — Pro |
| Vercel: Spend Management | **Pendiente por panel** (no se puede leer por API ni CLI) → **requiere decisión económica** |
| Vercel: variables `RESEND_*` | **No se eliminaron**: las inyecta una integración de Resend instalada en el proyecto (§5.3) |
| Vercel: dominios y aliases | **Verificado**, sin cambios |
| GitHub: secretos en el historial | **Verificado** — ninguno (139 revisiones, 13 patrones) |
| GitHub: correos personales y referencias innecesarias | **Aplicado** en el árbol actual (el historial público conserva lo anterior: §6.2) |
| GitHub: visibilidad del repositorio | **Requiere decisión** — recomendación: privado (§6.3) |
| Correo: SMTP, DKIM y SPF | **Verificado** |
| Correo: DMARC | **Aplicado** (no existía): `v=DMARC1; p=none;` |
| Correo: límites y panel de Resend | **Pendiente por panel** |
| Logs sin datos personales | **Verificado** |

## 2. Estado anterior leído (sólo lectura)

Supabase Auth (`supabase config pull` en una carpeta temporal, sin tocar el repo): registro abierto con correo, confirmación de correo obligatoria, `double_confirm_changes = false`, `secure_password_change = false`, `minimum_password_length = 6`, sin requisitos de complejidad, rotación de refresh tokens activa (`refresh_token_reuse_interval = 10`), OTP de 8 dígitos válido 1 h, máximo un correo por minuto, SMTP propio de Resend (`smtp.resend.com:465`, remitente `no-reply@teacherflowapp.com`), TOTP habilitado, límites por IP: `sign_in_sign_ups = 30`, `token_verifications = 30`, `token_refresh = 150` por 5 minutos y `email_sent = 30` por hora. Base: SSL no impuesto, red abierta (`0.0.0.0/0` y `::/0`), plan Free, sin Edge Functions. Vercel: plan Pro, firewall sin reglas propias (sólo las mitigaciones automáticas de DDoS), Bot Protection y OWASP apagados. DNS en Vercel (`ns1/ns2.vercel-dns.com`).

## 3. Supabase

### 3.1 Edge Functions — Verificado
`supabase functions list` → `[]`. No hay funciones desplegadas, así que no hay ninguna superficie extra que revisar.

### 3.2 Confirmación de correo y rotación de refresh tokens — Verificado
`enable_confirmations = true` (no se puede iniciar sesión sin confirmar el correo) y `enable_refresh_token_rotation = true` con `refresh_token_reuse_interval = 10` s (un token de refresco de dos generaciones atrás se rechaza con `refresh_token_already_used`; el inmediatamente anterior se tolera por si el cliente perdió la respuesta; ver `docs/REGRESION_PRE_REDISENO.md`).

### 3.3 Cambio seguro de contraseña — Aplicado y Verificado
`secure_password_change` pasó de `false` a `true`: cambiar la contraseña exige haber iniciado sesión hace poco (o reautenticarse). **Riesgo evaluado antes de activarlo:** el único camino para cambiar la contraseña en la web y en la app móvil es la **recuperación** (`updateUser({ password })` justo después de abrir el enlace del correo, con una sesión recién creada); ninguno de los dos tiene una pantalla «cambiar contraseña» con una sesión vieja. **Prueba sintética en Production** (usuario `@example.invalid` creado y borrado en la misma corrida, **sin enviar ningún correo**: el enlace de recuperación se generó por la API de administración): enlace de recuperación → sesión (200) → cambio con 7 caracteres **rechazado** (422 `weak_password`) → cambio con 8 o más **aceptado** (200) → la contraseña anterior ya no inicia sesión (400) → usuario borrado (200). Reversible: `secure_password_change = false`.

### 3.4 Política de contraseña — Aplicado (mínimo 8); complejidad: requiere decisión
`minimum_password_length` pasó de 6 a **8**. La web (`MIN_PASSWORD_LENGTH = 8`) y la app móvil (`MIN_PASSWORD_LENGTH = 8`) ya lo exigían en el cliente, así que ningún flujo existente cambia; sólo se cierra el hueco de llamar a la API directamente con 6 caracteres. **No se agregaron requisitos de complejidad** (`password_requirements`): ninguna de las dos apps los explica en pantalla, y activarlos haría fallar el alta con un error que el usuario no entiende. Si se quieren, hay que cambiar primero los dos clientes.

### 3.5 Imposición de SSL y red de la base
* **SSL — Aplicado y Verificado.** `ssl-enforcement update --enable-db-ssl-enforcement`. Antes de activarlo se comprobó quién se conecta **directo** a Postgres: la web (Vercel) y la app móvil usan sólo la API HTTPS de Supabase (`supabase-js`; no hay `pg`, `DATABASE_URL` ni cadenas `postgres://` en ninguno de los dos repos), así que no dependen de ese ajuste; sólo la CLI de Supabase usa conexión directa o por *pooler*, y ya negocia TLS. Después de activarlo: `migration list --linked`, `db push --dry-run` («Remote database is up to date») y `db query` (`ssl = on`) funcionan, `https://teacherflowapp.com/login` responde 200 y la pantalla de Inicio con sesión carga los datos sin errores de consola. Reversible: `--disable-db-ssl-enforcement`.
* **Restricción de red — No aplicable (se deja `0.0.0.0/0` y `::/0`).** Esa lista sólo gobierna las conexiones directas a Postgres, que sólo hace la CLI desde una IP dinámica de casa; restringirla dejaría a la CLI sin acceso cada vez que cambie la IP, y no protege la API HTTPS (que es lo que usan Vercel y el móvil, desde IPs de Vercel que cambian). Con SSL impuesto y contraseña fuerte el riesgo residual es bajo.

### 3.6 Límites por IP de Auth — Verificado, sin cambios
`sign_in_sign_ups = 30` y `token_verifications = 30` cada 5 minutos por IP, `token_refresh = 150`, `email_sent = 30` por hora (global del proyecto). **Atención al reducirlos alguna vez:** las acciones de la web (inicio de sesión, alta, recuperación) llaman a Supabase **desde los servidores de Vercel**, así que todos los usuarios de la web comparten unas pocas IPs de salida: un límite por IP más bajo se agotaría con tráfico normal. Por eso no se tocó; la protección contra abuso de la web va en el Firewall de Vercel (§5), que sí ve la IP real de cada persona.

### 3.7 Otros valores leídos (sin cambios, para decidir)
* `additional_redirect_urls` incluye `http://localhost:3000/**` (desarrollo) y `https://teacherflow-web.vercel.app/**` (comodín del dominio de Vercel). Recomendación: **quitar `localhost`** cuando no se desarrolle contra Production; lo dejo porque lo usa el desarrollo local.
* `site_url = https://teacherflowapp.com` (correcto).

## 4. CAPTCHA — Pendiente por credenciales; bloqueado por la app móvil

**Qué ya está hecho (R3):** la web tiene el widget de Cloudflare Turnstile en inicio de sesión, alta, reenvío de confirmación, recuperación, cambio de contraseña y borrado de cuenta, **desactivado** mientras no exista `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (sin clave: no se muestra nada, no se carga ningún script de terceros y todo funciona como antes; con una clave inválida o de ejemplo, igual). La CSP ya contempla `challenges.cloudflare.com`. Hay pruebas (`lib/auth/__tests__/captcha.test.ts`).

**Hallazgo nuevo que cambia el orden:** el CAPTCHA de Supabase es **del proyecto entero**: una vez activado, `signInWithPassword`, `signUp`, `resend` y `resetPasswordForEmail` exigen `captchaToken` **de todos los clientes**. La **app móvil no envía ningún token** (no hay rastro de CAPTCHA en su código) y un widget web no corre en React Native sin una WebView. Activar Supabase CAPTCHA hoy **rompería el inicio de sesión, el alta y la recuperación de la app móvil**. Por eso **no se activó nada**.

**Orden correcto de activación:**

1. *(Único paso manual por ahora, en Cloudflare)* Crear un sitio **Turnstile** (tipo «Managed») para el hostname `teacherflowapp.com` y anotar la **clave de sitio** (pública) y la **clave secreta**. No hay que pasármelas en el chat: la de sitio va a Vercel y la secreta sólo a Supabase.
2. Cargar `NEXT_PUBLIC_TURNSTILE_SITE_KEY` en Vercel (Production) y desplegar (la web empieza a mostrar el widget; Supabase todavía no lo exige, así que nada se rompe).
3. Publicar una versión de la app móvil que obtenga y envíe el token (por ejemplo con una WebView de Turnstile) — **decisión de producto y trabajo en la app móvil**, que acá no se toca.
4. **Recién entonces**, Supabase › Authentication › Bot and Abuse Protection › activar CAPTCHA (Turnstile) con la clave secreta.

**Alternativa sin tocar el móvil:** dejar Supabase CAPTCHA apagado y proteger **sólo la web** con el Firewall de Vercel (§5): pasar las reglas de Log a *Challenge* cuando los registros muestren abuso real.

**Comportamiento si faltan las claves:** el formulario funciona como siempre (probado por `captcha.test.ts`); si Supabase tuviera CAPTCHA activo y faltara el token, Supabase responde con un error de verificación que la web muestra como el mensaje genérico de la acción (no expone nada).

## 5. Vercel

### 5.1 Reglas del Firewall — Aplicado (modo Log)
Tres reglas **de sólo registro** (no bloquean ni desafían nada), publicadas en Production:

| Regla | Condición | Umbral | Si se supera |
|---|---|---|---|
| `R7 log inicio de sesión` | `POST /login` | 20 por minuto por IP | **log** |
| `R7 log alta de cuenta` | `POST /crear-cuenta` | 10 por minuto por IP | **log** |
| `R7 log recuperación de contraseña` | `POST /recuperar-contrasena` | 10 por minuto por IP | **log** |

**Cómo se eligieron los valores (tráfico real, no inventado).** En las últimas 24 h el sitio recibió ≈ 600 pedidos en total (504 permitidos, 95 denegados por la mitigación automática —casi todos exploradores de `/wp-admin`—, 12 desafiados); el cliente más activo (la propia cuenta de pruebas) hizo 171 pedidos en el día **entre todas las páginas**. Una persona legítima hace 1–3 intentos por minuto en estos formularios; 20/10/10 por minuto es **varias veces** eso, y como las reglas sólo registran, el peor caso es un falso positivo en el registro, nunca un bloqueo. Sólo cuentan los `POST` (los envíos de formulario): la navegación normal (`GET`) no pasa por estas reglas.

**Próximo paso (cuando haya datos):** mirar `vercel firewall overview` / `traffic list` tras una o dos semanas; si aparece abuso real, pasar la acción a *challenge* o *deny* (`vercel firewall rules edit …` y `publish`). Reversible: `vercel firewall rules disable|remove <regla>` y `publish`.

### 5.2 Plan y Spend Management
* **Plan: Verificado — Pro** (equipo `teacherflow`).
* **Spend Management: Pendiente por panel.** Vercel no lo expone por API ni por CLI (los endpoints de gasto responden 404). Hay que mirarlo en el panel: *Settings › Billing › Spend Management*. **Requiere decisión económica:** definir un tope mensual con aviso al llegar al 50/75/100 %. No se cambió nada.

### 5.3 Variables `RESEND_*` — No eliminadas
`RESEND_API_KEY` y `RESEND_EMAIL_DOMAIN` (Production, tipo *Secret*, de hace 4 días) **no las usa ningún código** (búsqueda en el árbol actual y en todo el historial: sólo aparecen palabras como «resend» de los botones de reenvío de confirmación). Pero hay una **integración de Resend instalada en el proyecto** (`resend-email-gray-envelope`, estado *Available*) que es quien las inyecta. El requisito era eliminarlas sólo si ninguna integración las usa: **la integración las gestiona**, y además son secretos de tipo *Secret* (no se podrían recuperar). **Decisión pendiente:** si no se necesita la integración (el SMTP de Supabase tiene su propia clave guardada en Supabase), desinstalarla desde el panel de Vercel (*Integrations › Resend › Remove from project*) elimina las variables de forma limpia.

### 5.4 Dominios y aliases — Verificado, sin cambios
`teacherflowapp.com` sigue en Vercel (DNS de Vercel). No se tocó ningún dominio ni alias.

## 6. GitHub

### 6.1 Secretos — Verificado
Se buscaron, en **las 139 revisiones de todas las ramas**, 13 patrones de credenciales (JWT largos, `sb_secret_`, `sb_publishable_`, claves de Resend `re_…`, `sk-…`, `sk-ant-…`, claves privadas PEM, `ghp_`, `AKIA…`, URLs `postgres://usuario:clave@…`, `sbp_…`, tokens de Slack, `service_role` junto a un JWT): **ninguna credencial real**. Las únicas coincidencias son claves *publicables* de ejemplo (`sb_publishable_example…`, `…abc123…`) en `.env.example` y en una prueba. Sólo se versionó `.env.example` (nunca un `.env`).

### 6.2 Correos personales y referencias innecesarias — Aplicado en el árbol actual
Se retiraron de `docs/`, `supabase/tests`, `lib/**/__tests__` y un comentario: el **correo real de la profesora**, los **ids de las cuentas QA descartables**, el **identificador del proyecto de Supabase** y un nombre propio de la profesora; las pruebas que usaban un id real como dato de ejemplo ahora usan uno sintético (206 + 130 pruebas de auth, errores y respaldo pasan). **Lo que no se puede deshacer sin decisión:** esos datos **siguen en el historial público** de git; quitarlos exige reescribir la historia (`git filter-repo` + *force push*), que cambiaría todos los commits y rompería cualquier copia local: **no se hizo**. Si el repositorio pasa a privado (§6.3) el problema deja de ser público. Quedan 41 menciones del nombre de pila del propietario en comentarios y documentos («a pedido de Joaquín»): no se tocaron.

### 6.3 Visibilidad — Requiere decisión (recomendación: privado)
El repositorio `pablosecuen/stepup` es **público**, con 0 *forks*, 0 estrellas, 2 ramas y **sin flujos de GitHub Actions**. **Vercel no depende de GitHub**: los despliegues se hacen con la CLI desde un árbol local limpio (el *push* no despliega), así que **hacerlo privado no afecta a Vercel ni a ningún acceso conocido**. Conviene hacerlo **privado**: el código y las migraciones muestran toda la superficie de la aplicación (políticas, funciones, límites) sin ningún beneficio comercial de tenerlo público. Es un cambio de un clic del propietario en *Settings › General › Danger Zone*; no se hizo. Pendiente por panel: confirmar que *Secret scanning* y *Push protection* están activos (no se leen sin credenciales de GitHub; en un repositorio privado requieren GitHub Advanced Security).

## 7. Correo

* **Dominio y SMTP — Verificado.** Supabase envía por `smtp.resend.com:465` como `no-reply@teacherflowapp.com`.
* **DKIM — Verificado:** `resend._domainkey.teacherflowapp.com` publicado. **SPF — Verificado:** `send.teacherflowapp.com` (`v=spf1 include:amazonses.com ~all`) con su MX de retorno (`feedback-smtp.sa-east-1.amazonses.com`); el remitente alinea por DKIM.
* **DMARC — Aplicado:** no existía ningún registro. Se agregó `_dmarc.teacherflowapp.com` = `v=DMARC1; p=none;` (modo **monitor**: no rechaza nada, sólo declara la política; verificado por DNS público). **Decisión pendiente:** agregar `rua=mailto:<correo de reportes>` (necesita el correo público de soporte, una de las decisiones de negocio que no se inventan) y, con los reportes a la vista, subir a `p=quarantine`. Reversible: borrar el registro (`vercel dns rm`).
* **Límites de Resend — Pendiente por panel.** No hay acceso al panel de Resend: no se pudo comprobar el plan ni la cuota (R3 documentó el plan gratuito: 100 correos por día y 3.000 por mes, compartidos por todos los correos de Supabase Auth; `email_sent = 30` por hora en Supabase la queda por debajo). No se envió ningún correo de prueba.

## 8. Costos — qué requiere una decisión económica

* **Vercel Spend Management** (§5.2): definir tope y avisos — hoy no se puede ver.
* **Supabase plan Free:** sin copias de seguridad automáticas listadas ni recuperación a un punto en el tiempo; pasar a Pro (cuesta dinero) las agrega. Es una decisión de negocio ligada al lanzamiento (decisiones 5 y 6 de `CLAUDE.md`); **no se cambió de plan**.
* **Resend:** si el volumen de altas supera 100 correos por día, hace falta un plan pago.
* **CAPTCHA con Turnstile:** gratuito.
* **GitHub privado:** gratuito para repositorios personales.

## 9. Pruebas

* **Auth contra Production con un usuario sintético** (§3.3): cambio de contraseña con la política nueva, sin correos, usuario borrado.
* **CLI, deploy y Production con SSL impuesto** (§3.5): `migration list`, `db push --dry-run`, `db query`, `/login` y la pantalla de Inicio con sesión.
* **Firewall sin bloquear la navegación:** las reglas sólo cuentan `POST` y sólo registran; `GET /login` responde 200 y la sesión navega normalmente. Hay 3 reglas activas; ninguna puede denegar ni desafiar (sólo registran).
* **Cabeceras y cookies intactas:** `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` y la CSP en modo reporte siguen presentes; no se tocó ningún código de cookies ni de sesión (**B0** —la causa externa del *issued at in the future*, `docs/SUPABASE_SUPPORT_JWT_ISSUED_AT_FUTURE.md`— sigue abierto y no cambió).
* **Logs sin datos personales:** 1.000 entradas de 7 días de Production: 0 con correos, 0 con tokens; 30 con un identificador opaco dentro de la ruta (`/alumnos/<id>`), sin nombres ni teléfonos; los mensajes de la aplicación son códigos genéricos.
* **Login, alta y recuperación con CAPTCHA desactivado y comportamiento si faltan las claves:** cubiertos por `lib/auth/__tests__` (CAPTCHA, adaptador de autenticación, recuperación) — 206 pruebas de auth y errores pasan.
* **Código:** sólo cambiaron pruebas, un comentario y documentos; typecheck, lint, build y suite completa limpios (§11).

## 10. Lista de pendientes manuales de R7

1. **Cloudflare:** crear el sitio Turnstile (§4, paso 1). Hasta que la app móvil envíe el token, **no activar** CAPTCHA en Supabase.
2. **Vercel (panel):** definir Spend Management (§5.2).
3. **Vercel (panel):** decidir si se desinstala la integración de Resend (§5.3).
4. **GitHub (panel):** decidir si el repositorio pasa a privado (§6.3) y confirmar *Secret scanning* / *Push protection*.
5. **Resend (panel):** revisar plan y cuota; decidir el correo de reportes DMARC (§7).
6. **Supabase (panel):** decidir si se quita `localhost` de las URL de redirección (§3.7) y si hace falta un plan con copias de seguridad (§8).
7. **Cuando haya datos (1–2 semanas):** revisar el registro del Firewall y decidir si pasa de Log a Challenge (§5.1).

## 11. Verificación del código

Typecheck, lint y `next build` limpios; suite completa **1.101/1.101** (sobre una copia con saltos de línea LF). El código sólo cambió en pruebas (ids de ejemplo sintéticos) y en un comentario, por eso no hubo un nuevo deploy: lo desplegado (`dpl_7YJYTAHeyc2sZhxFJqpRb1thf7JL`) se comporta igual.
