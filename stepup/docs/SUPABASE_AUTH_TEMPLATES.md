# Supabase Auth — plantillas compartidas web + móvil (recuperación y alta)

Documento de referencia para configurar Supabase Auth con el flujo seguro de `/auth/confirm` (código ya desplegado en Production, commit `6930b83`). **Nada de esto está aplicado en Supabase.** Copiá cada bloque directamente desde este archivo, no desde un chat renderizado.

## Por qué las plantillas son condicionales

El proyecto de Supabase es **uno solo y compartido** entre la web y la app móvil, y Supabase tiene **una única plantilla por tipo de correo**. Las dos clientes piden el correo con un `redirectTo` distinto:

| Cliente | Recuperación | Alta |
|---|---|---|
| Web | `https://teacherflowapp.com/auth/confirm` | `https://teacherflowapp.com/auth/confirm` |
| Móvil | `teacherflow://reset-password` | `teacherflow://auth-confirmed` |

La app móvil usa PKCE: lee `?code=` del deep link (que arma `{{ .ConfirmationURL }}`) y, para el alta, también el código de 6 dígitos. Si se pegara una plantilla sólo web, el correo móvil llevaría `teacherflow://reset-password?token_hash=…`, que la app no reconoce. Por eso cada plantilla ramifica con un condicional de Go Template (oficial en Supabase) sobre `{{ .RedirectTo }}`:

- Si `.RedirectTo` es **exactamente** el redirect móvil → plantilla móvil actual, **sin cambios** (`{{ .ConfirmationURL }}`).
- Cualquier otro redirect permitido → plantilla web en español con `token_hash` + código de 6 dígitos.

Reglas de las plantillas:
- Sólo variables oficiales de Supabase: `{{ .RedirectTo }}`, `{{ .TokenHash }}`, `{{ .Token }}` y `{{ .ConfirmationURL }}`.
- **No se usa `{{ .SiteURL }}`** para construir enlaces (así cambiar la Site URL no altera ningún correo).
- Cada plantilla tiene exactamente un `{{ if … }}`, un `{{ else }}` y un `{{ end }}`.
- El `&` del enlace web va escapado como `&amp;` (HTML válido).
- `{{ .RedirectTo }}` sólo aparece dentro del `if` como valor a comparar y, en la rama web (siempre `https://`), como inicio del enlace. La rama móvil nunca lo inserta en un `href`.

## 1. Redirect URLs (Authentication → URL Configuration)

**Agregar** (nueva):

```text
https://teacherflowapp.com/auth/confirm
```

**Conservar** (no borrar):

```text
https://teacherflow-web.vercel.app/auth/confirm
https://teacherflow-web.vercel.app/auth/callback
teacherflow://reset-password
teacherflow://auth-confirmed
```

Las dos `teacherflow://…` son de la app móvil: nunca se quitan. Las dos de `vercel.app` se conservan temporalmente (correos ya enviados y acceso por el dominio anterior).

**Site URL** (sólo fallback; ninguna plantilla la usa):

```text
https://teacherflowapp.com
```

## 2. "Reset Password" (Authentication → Email Templates)

Asunto (compartido por web y móvil; Supabase usa un único asunto por plantilla):

```text
Restablecé tu contraseña de TeacherFlow
```

Cuerpo completo:

```html
{{ if eq .RedirectTo "teacherflow://reset-password" }}
<h2>Reset your password</h2>

<p>We received a request to reset your password. Follow the link below to choose a new one.</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>

<p>If you didn't request this, you can safely ignore this email.</p>
{{ else }}
<h2>Elegí una contraseña nueva</h2>
<p>Tocá el botón para elegir una contraseña nueva en TeacherFlow. El enlace funciona una sola vez y sirve desde cualquier dispositivo.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery">Elegir contraseña nueva</a></p>
<p>Si el enlace no funciona, abrí la pantalla "Recuperar contraseña" y escribí este código de 6 dígitos:</p>
<p style="font-size:24px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Si no pediste este cambio, ignorá este correo.</p>
{{ end }}
```

## 3. "Confirm signup" (Authentication → Email Templates)

Asunto (compartido):

```text
Confirmá tu correo en TeacherFlow
```

Cuerpo completo:

```html
{{ if eq .RedirectTo "teacherflow://auth-confirmed" }}
<h2>Confirm your email address</h2>

<p>Follow the link below to confirm this email address and finish signing up.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
{{ else }}
<h2>Confirmá tu correo</h2>
<p>Gracias por crear tu cuenta en TeacherFlow. Tocá el botón para activarla. El enlace funciona una sola vez y sirve desde cualquier dispositivo.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Confirmar mi correo</a></p>
<p>Si el enlace no funciona, escribí este código de 6 dígitos en la pantalla de creación de cuenta:</p>
<p style="font-size:24px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Si no creaste esta cuenta, ignorá este correo.</p>
{{ end }}
```

## 4. Valor exacto de `redirectTo` que envía cada cliente

La web arma `redirectTo` (y `emailRedirectTo` para el alta y su reenvío) como `${origin}/auth/confirm`, con `origin` tomado del host de la petición. En `https://teacherflowapp.com`:

```text
https://teacherflowapp.com/auth/confirm
```

El enlace final de la rama web queda así (valores ficticios):

```text
https://teacherflowapp.com/auth/confirm?token_hash=pkce_0123456789abcdef&type=recovery
https://teacherflowapp.com/auth/confirm?token_hash=pkce_0123456789abcdef&type=email
```

La app móvil usa constantes fijas (`teacherflow://reset-password` y `teacherflow://auth-confirmed`), que activan la rama móvil.

Si el `redirectTo` no estuviera en la lista de Redirect URLs, Supabase lo reemplaza por la Site URL y el enlace se rompe: por eso las Redirect URLs van primero.

## 5. Riesgos conocidos y cómo se cubren

- **Cualquier `redirectTo` distinto del móvil exacto cae en la rama web.** Un `redirectTo` móvil con otro valor (por ejemplo un build de desarrollo con `exp://…`) recibiría el correo web y no funcionaría. Hoy la app usa sólo las dos constantes `teacherflow://`; si se agregara otro esquema habría que sumar su rama.
- **`{{ .RedirectTo }}` dentro de `href` con esquemas personalizados** tiene una incidencia pública abierta (supabase/auth#29156). No aplica a este diseño, porque la rama móvil usa `{{ .ConfirmationURL }}` y la rama web sólo ve `https://`. Aun así **no se puede verificar la condición sin enviar un correo**, por eso la prueba final de la sección 6 incluye ambos clientes.
- **Un error de tipeo en la condición** mandaría a todos a la rama web. Copiá el bloque completo desde este archivo, sin retocarlo.
- **El asunto no se ramifica**: es el mismo para web y móvil. Si querés conservar el asunto móvil actual, pegá el tuyo en lugar del sugerido.

## 6. Orden de configuración (cero interrupción)

1. **Respaldo.** Copiá en un archivo propio el HTML y el asunto actuales de "Reset Password" y "Confirm signup" (no contienen secretos). Sirve para el rollback.
2. **Redirect URLs.** Agregar `https://teacherflowapp.com/auth/confirm` (sección 1). No cambia nada para nadie.
3. **Site URL.** Cambiar a `https://teacherflowapp.com`.
4. **Plantillas.** Pegar las de las secciones 2 y 3 (asunto + cuerpo).
5. **Prueba web.** En `https://teacherflowapp.com`, con la cuenta QA: pedir la recuperación en la PC, abrir el enlace en el iPhone, confirmar y cambiar la contraseña.
6. **Prueba móvil.** Desde la app, con la cuenta QA: pedir la recuperación y comprobar que el correo llega en inglés (rama móvil) y que el enlace abre la app. Probar también el alta con un correo propio.

**Rollback:** restaurar las plantillas respaldadas y la Site URL anterior (`http://localhost:3000`).

## 7. Resultado de las pruebas reales (4 de octubre de 2026, cuenta QA, Production)

- **Recuperación web en `https://teacherflowapp.com`: pasó completa.** Correo entregado (Delivered en Resend), contraseña actualizada e inicio de sesión exitoso. Es el mecanismo operativo de recuperación durante la transición.
- **Rama móvil de "Reset Password": el correo llegó, pero el deep link no abrió.** Se pidió un correo con `redirect_to` exacto `teacherflow://reset-password` (enviado directo a Supabase con un `code_challenge` PKCE de prueba, no desde la app). Al pulsar el enlace, Safari en el iPhone mostró "no puede abrir la página porque la dirección no es válida". Se documenta como **fallo preexistente del deep link `teacherflow://` en ese iPhone**, ajeno a las plantillas: la rama móvil conserva literalmente la plantilla anterior y el esquema personalizado no abre en el dispositivo. La causa no se investigó y no se corrigió el móvil.
- **Alcance de esa prueba:** al pedirse sin la app, el verificador PKCE no existía en el iPhone, así que aunque el deep link hubiera abierto la app, el canje no habría podido completarse. No quedó probado "elegir contraseña" en el móvil.
- **Rama web de "Confirm signup": funcionó.** Con una cuenta temporal creada desde `https://teacherflowapp.com/crear-cuenta`, el enlace llevó a `/auth/confirm`, el botón "Confirmar mi correo" verificó el token (`email_confirmed_at` quedó registrado 17 s después de crear la cuenta) y se creó la sesión. Los logs de Vercel muestran `GET /auth/confirm` → `POST /auth/confirm` → `GET /inicio`, sin errores.
- **Lo que falló fue la UX, no la verificación.** Tras confirmar, la persona caía directo en Inicio sin ninguna señal de éxito, y el botón no mostraba estado de espera. Un segundo toque lanzaba otra verificación con el mismo token ya consumido (`POST` a `/inicio` con la acción de confirmar y, 1 s después, `GET /auth/error`) y se veía "enlace vencido" justo después de haber confirmado bien. Corregido en el código (sin deploy todavía): el botón queda deshabilitado con "Confirmando…", la alta termina en `/auth/confirmado` ("Cuenta confirmada" + "Iniciar sesión") y un enlace ya usado se muestra como aviso con "Iniciar sesión" como acción principal.
- **Error de tipeo en la prueba:** el primer intento de alta usó una dirección con una letra de menos en la parte local (`atias…` en lugar de `matias…`). Quedó una segunda cuenta sin confirmar (1 identidad, sin filas de negocio ni Storage) y su correo de confirmación salió hacia esa dirección ajena. Sigue pendiente decidir su limpieza.
- **Sin probar:** rama móvil de "Confirm signup".
- **Plantillas y Supabase:** sin cambios en esta ronda.
