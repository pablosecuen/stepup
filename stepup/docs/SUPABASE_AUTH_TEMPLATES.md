# Supabase Auth — valores para copiar (recuperación y alta)

Documento de referencia para configurar Supabase Auth con el flujo seguro de `/auth/confirm` (commit local `6930b83`, todavía sin push ni deploy). **Nada de esto está aplicado en Supabase.** Copiá cada bloque directamente desde este archivo, no desde un chat renderizado.

Todas las plantillas usan sólo variables oficiales de Supabase: `{{ .RedirectTo }}`, `{{ .TokenHash }}` y `{{ .Token }}`. Ninguna usa `{{ .ConfirmationURL }}`, que es la que lleva al canje PKCE (atado al navegador que pidió el correo y consumible por un escáner del correo).

## 1. Redirect URL exacta (Authentication → URL Configuration → Redirect URLs)

Agregar esta entrada. Conservar la existente `/auth/callback`.

```html
https://teacherflow-web.vercel.app/auth/confirm
```

## 2. Plantilla completa "Reset Password" (Authentication → Email Templates)

Asunto sugerido: `Elegí una contraseña nueva en TeacherFlow`

```html
<h2>Elegí una contraseña nueva</h2>
<p>Tocá el botón para elegir una contraseña nueva en TeacherFlow. El enlace funciona una sola vez y sirve desde cualquier dispositivo.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery">Elegir contraseña nueva</a></p>
<p>Si el enlace no funciona, abrí la pantalla "Recuperar contraseña" y escribí este código de 6 dígitos:</p>
<p style="font-size:24px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Si no pediste este cambio, ignorá este correo.</p>
```

## 3. Plantilla completa "Confirm signup" (Authentication → Email Templates)

Asunto sugerido: `Confirmá tu correo en TeacherFlow`

```html
<h2>Confirmá tu correo</h2>
<p>Gracias por crear tu cuenta en TeacherFlow. Tocá el botón para activarla. El enlace funciona una sola vez y sirve desde cualquier dispositivo.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Confirmar mi correo</a></p>
<p>Si el enlace no funciona, escribí este código de 6 dígitos en la pantalla de creación de cuenta:</p>
<p style="font-size:24px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Si no creaste esta cuenta, ignorá este correo.</p>
```

## 4. Valor exacto de `redirectTo` que envía el código

El código arma `redirectTo` (y `emailRedirectTo` para el alta y su reenvío) como `${origin}/auth/confirm`, donde `origin` sale del host de la petición. En Production:

```html
https://teacherflow-web.vercel.app/auth/confirm
```

Por eso `{{ .RedirectTo }}` en las plantillas vale exactamente ese valor, y el enlace final del correo queda así (ejemplo con valores ficticios):

```html
https://teacherflow-web.vercel.app/auth/confirm?token_hash=pkce_0123456789abcdef&type=recovery
```

Para el correo de alta, el mismo enlace con `type=email`:

```html
https://teacherflow-web.vercel.app/auth/confirm?token_hash=pkce_0123456789abcdef&type=email
```

Si `{{ .RedirectTo }}` no estuviera en la lista de Redirect URLs, Supabase lo reemplaza por la Site URL y el enlace se rompe: por eso el paso A va primero.

## 5. Orden de configuración y despliegue (cero interrupción)

1. **A. Agregar la Redirect URL** de la sección 1. No cambia nada para nadie.
2. **B. Desplegar el código compatible** (`git push origin teacherflow-web` y `npx.cmd vercel deploy --prod`, con autorización aparte). Es compatible con las plantillas viejas: sus enlaces `?code=` pasan por `/auth/confirm` → `/auth/callback`, que decide el destino. En el mismo navegador siguen funcionando.
3. **C. Cambiar las plantillas** "Reset Password" y "Confirm signup" por las de las secciones 2 y 3.
4. **D. Probar con la cuenta QA entre PC e iPhone:** pedir la recuperación en la PC, abrir el enlace en el iPhone, confirmar y cambiar la contraseña; después una alta sintética con un correo propio.

Si algo falla antes del paso C no hay regresión: las plantillas viejas siguen funcionando en el mismo navegador.
