# Informe para soporte de Supabase — PostgREST rechaza con "JWT issued at future" un token recién emitido por Auth

**Estado:** borrador. **No enviado.** Los campos marcados `[COMPLETAR]` salen del panel de Supabase (Logs → API Edge / PostgREST) y no los tengo yo.

## Resumen

Un token de acceso **válido**, emitido por Supabase Auth, es rechazado por PostgREST pocas décimas de segundo después con `401 PGRST303` y el mensaje exacto **`JWT issued at future`**. Ocurre de forma intermitente, en consultas simultáneas con el mismo token: algunas dan 200 y otras 401. No hay ninguna modificación de claims ni de claves de firma de nuestra parte.

## Datos del proyecto

| Dato | Valor |
|---|---|
| Project ref | `<project-ref>` |
| Servicios implicados | Auth (`/auth/v1/token`, `/auth/v1/user`) y PostgREST (`/rest/v1/*`) |
| Cliente | `@supabase/ssr` 0.12.7 + `@supabase/supabase-js` 2.116.0, ejecutado en Vercel (Next.js 16.3.4) |
| Clave usada | publicable (`sb_publishable_…`) + el JWT del usuario en `Authorization` |

## Error exacto

```json
{ "code": "PGRST303", "message": "JWT issued at future" }
```

HTTP 401 en `GET/POST /rest/v1/<tabla>`. Capturado por nuestra aplicación (sin token ni datos) como:

```text
[jwt-retry] {"table":"students","code":"PGRST303","detail":"JWT issued at future","recovered":true}
[jwt-retry] {"table":"students","code":"PGRST303","detail":"JWT issued at future","recovered":false}
[jwt-retry] {"table":"students","code":"PGRST303","detail":"JWT issued at future","recovered":false}
```

## Cronología del caso documentado (4 de octubre de 2026, UTC)

Un usuario de prueba inicia sesión con contraseña y de inmediato se cargan varias consultas con el mismo token.

| Hora (UTC) | Evento | Fuente |
|---|---|---|
| 12:52:25.372 | Llega `POST /login` a nuestro servidor | Log de Vercel |
| **12:52:26.584** | **Auth crea la sesión** (`auth.sessions.created_at`) | Base de datos de Auth |
| **12:52:26.633** | **Auth emite el refresh token** (`auth.refresh_tokens.created_at`) | Base de datos de Auth |
| 12:52:26.883 | Llega `GET /inicio` y se disparan las consultas (`/auth/v1/user` 200, `/rest/v1/*`) | Log de Vercel |
| ≈12:52:26.9 | Una o más consultas a `/rest/v1/students` reciben `401 PGRST303 "JWT issued at future"` | Log de Vercel + `[jwt-retry]` |
| ≈12:52:27.2 | Reintento tras 350 ms (versión anterior de nuestro reintento): 1 consulta se recupera, 2 siguen rechazadas | `[jwt-retry]` |

Es decir, el token se emitió unos **0,3 s antes** de la primera consulta de datos, y PostgREST lo consideró emitido en el futuro.

### Caso de control (mismo usuario, mismo código, instantes después)

| Hora (UTC) | Evento |
|---|---|
| 12:53:06.700 | Llega `POST /login` |
| 12:53:07.205 | Auth crea la sesión |
| 12:53:07.312 | Llega `GET /inicio`: **todas** las consultas responden 200, **sin** `[jwt-retry]` |

Este token era **más joven** (≈0,1 s) que el rechazado (≈0,3 s) y fue aceptado. Por eso no parece un desfase fijo y uniforme, sino algo que depende de la instancia que atiende cada consulta.

### Otros casos del mismo comportamiento (motivo no registrado entonces)

- 2026-10-04 ≈02:30:25 UTC (23:30 hora de Argentina): `PGRST303` en la carga de Inicio, ≈1,3 s después de un login con contraseña.
- 2026-10-04 03:48:38.565 UTC: `PGRST303` en `GET /rest/v1/recurrence_rules`; en el mismo segundo `/auth/v1/user`, `/rest/v1/students` y `/rest/v1/calendar_lessons` respondieron 200 para el mismo usuario.

## Segundo caso con la mitigación activa (4 de octubre de 2026, 18:00 UTC)

Mismo flujo (login con contraseña y carga inmediata de Inicio). Nuestro reintento único espera hasta que el token tenga ~3 s de vida desde su `iat`.

| Hora (UTC) | Evento |
|---|---|
| 18:00:37.195 | Llega `POST /login` |
| **18:00:38.251** | **Auth crea la sesión** (`auth.sessions.created_at`) |
| 18:00:38.285 | Auth emite el refresh token |
| 18:00:38.486 | Llega `GET /inicio` (0,24 s después de crear la sesión) |
| ≈18:00:40.1 | PostgREST rechaza `recurrence_rules` con `PGRST303 "JWT issued at future"` (el token ya tenía ≈1,9 s) |
| ≈18:00:41.0 | Tras esperar 882 ms, **la misma consulta** vuelve a ser rechazada por el mismo motivo (el token ya tenía ≈2,7 s): `recovered:false` |
| ≈18:00:41.0 | Otra consulta idéntica a `recurrence_rules`, con el mismo token y la misma espera (`waitedMs:882`), **sí se recupera** (`recovered:true`) |

Registro de nuestra aplicación (sin token, `iat`, UID ni consultas):

```text
[jwt-retry] {"table":"recurrence_rules","code":"PGRST303","detail":"JWT issued at future","recovered":false,"waitedMs":882}
[jwt-retry] {"table":"recurrence_rules","code":"PGRST303","detail":"JWT issued at future","recovered":true,"waitedMs":882}
[load-failure] {"scope":"inicio","kind":"database","code":"PGRST303","name":null,"detail":"JWT issued at future"}
```

Lo relevante para soporte: dos consultas iguales, con el mismo token y en el mismo instante, tuvieron resultados distintos tras la espera, y una instancia siguió rechazando un token de ≈2,7 s de vida. Eso apunta a que **al menos una instancia de PostgREST tiene su reloj atrasado más de ~2,7 s** respecto de quien emite el token. Resumen de logins desde el 3 de octubre: 4 con este fallo y 3 sin él.

## Qué descartamos de nuestro lado

- **Cliente distinto o token distinto:** el cliente es uno por request y todas las consultas paralelas usan el mismo token (verificado con pruebas contra los clientes reales).
- **Cookies o sesiones antiguas:** 12 escenarios simulados (sesión vieja vencida, vigente, revocada, fragmentada, otros paths, carreras de refresh) usan siempre la sesión nueva.
- **Datos faltantes o permisos:** una cuenta sin filas devuelve `[]` con 200; la misma cuenta cargó bien segundos antes y después.
- **Reloj de nuestro servidor:** la hora de Vercel (≥12:52:26.883) es coherente con la de la base de datos de Auth (12:52:26.584).

## Hipótesis (no confirmada)

El reloj de la instancia de PostgREST que atendió la consulta está atrasado respecto del de Auth en más de ~0,3 s, o el `iat` del token se calcula con un reloj adelantado. Lo que no podemos ver desde fuera es qué instancia atendió cada consulta ni su hora.

## Qué pedimos

1. Confirmar si hay desfase de reloj entre las instancias de Auth y PostgREST de este proyecto y de qué magnitud.
2. Indicar si PostgREST aplica tolerancia al `iat` (por ejemplo `clock skew` de unos segundos) y si se puede configurar.
3. Para las peticiones listadas abajo, revisar qué instancia de PostgREST las atendió y su hora.

## Identificadores de las peticiones (a completar desde Supabase → Logs → API Gateway)

Las horas del panel pueden mostrarse en hora de Argentina (UTC−3): 12:52 UTC = 09:52 y 18:00 UTC = 15:00. Para cada fila, abrir el detalle y copiar el identificador de petición que muestre (`x-request-id` / `sb-request-id`), el `cf-ray` si aparece, la hora exacta y el estado.

| # | Qué fila | Filtro / hora (UTC) | Para qué sirve | Identificadores |
|---|---|---|---|---|
| 1 | `POST /auth/v1/token` (`grant_type=password`), 200 | 18:00:37–18:00:38 | Emisión del token del caso principal | `[COMPLETAR]` |
| 2 | `GET /auth/v1/user`, 200 | 18:00:38–18:00:40 | Mismo token reconocido por Auth | `[COMPLETAR]` |
| 3 | `GET /rest/v1/recurrence_rules`, **401** | ≈18:00:40.0–18:00:40.5 | **Primer rechazo** "JWT issued at future" | `[COMPLETAR]` |
| 4 | `GET /rest/v1/recurrence_rules`, **401** | ≈18:00:40.9–18:00:41.5 | **Reintento que siguió rechazado** (token de ≈2,7 s) | `[COMPLETAR]` |
| 5 | `GET /rest/v1/recurrence_rules`, **200** | ≈18:00:40.9–18:00:41.5 | **Misma consulta y mismo token que sí fue aceptada** | `[COMPLETAR]` |
| 6 | `GET /rest/v1/students`, **401** | ≈12:52:26.8–12:52:27.5 | Caso del 4/oct 12:52 (primer incidente medido) | `[COMPLETAR]` |
| 7 | `GET /rest/v1/*`, 200 (control) | ≈12:53:07.2–12:53:07.6 | Token aún más joven aceptado | `[COMPLETAR]` |

Además, para cada fila 3 a 6, si el panel lo muestra: región/instancia que atendió la petición.

## Mitigación en nuestra aplicación

Un rechazo con el motivo exacto "JWT issued at future" ya no se trata como un error de carga: Inicio muestra una pantalla "Estamos terminando de iniciar tu sesión…", espera con backoff (2 s, 3 s y 5 s; límite total de 10 s), comprueba con consultas de solo lectura (`select id … limit 1`) y recién entonces vuelve a cargar Inicio. Si se agota el límite, muestra el error normal con "Reintentar" y "Cerrar sesión". Es una mitigación de una inconsistencia externa, no una corrección: el origen del desfase sigue sin identificarse. Cada comprobación deja `[session-recovery] {"attempt","status","code"}` en nuestros logs.
