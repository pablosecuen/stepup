# 06 · Bloque 1 — Fundaciones y estructura (implementado, en revisión visual)

Rama local `v1-web` (worktree `C:\Users\joaqu\tf-web-v1`), partiendo de `815ace5`. **Sin push ni deploy** hasta la revisión.

## Qué incluye

| Área | Cambio |
|---|---|
| Tokens | `tailwind.config.ts` y `app/globals.css` (`--tf-*`): papel cálido, tinta, terracota, tonos de estado, barra lateral oscura, radios, sombras, animaciones, breakpoint `nav` (820 px). Prueba de paridad Tailwind ↔ CSS. |
| Tipografías | `next/font/google`: Hanken Grotesk (interfaz) y Fraunces (títulos), autoalojadas (CSP `font-src 'self'`). |
| Base | Fondo, bordes, sombras y foco (anillo de tinta 2,5 px; marfil sobre superficies oscuras). Reglas de 44 px intactas. |
| Componentes (`components/ui/`) | `button` (`Button`, `PrivateButtonLink`, `buttonClass`, `linkClass`, `Spinner`), `field` (`Field`, `TextInput`, `SelectInput`, `TextArea`), `notice`, `badge`, `card`, `avatar`, `table`, `dialog` (centrado / hoja inferior), `menu-styles`, `status-circle`, `brand`. Enlaces públicos en `components/auth/public-links.tsx` (`ButtonLink`, `TextLink`: el área privada nunca importa `next/link`). |
| Shell privado | Barra lateral de 236 px; barra superior e inferior móviles; menú de cuenta (panel en escritorio, hoja inferior en móvil). |
| Acceso | Landing, login, crear cuenta (incl. «enlace enviado» y reenvío), recuperar contraseña, código de 6 dígitos, confirmar enlace, cuenta confirmada, error de enlace, nueva contraseña, iniciando sesión, «cuenta no disponible». |
| Estados globales | Esqueleto de carga, error de ruta, 404, error global, `EmptyState` (con ícono opcional), `ErrorState`, `LoadingState`. |

## Qué NO cambió

Lógica de negocio, Supabase, migraciones, autenticación, datos, rutas, textos funcionales y la escala de color del calendario. `PrivateLink` (sin precarga) sigue siendo el único enlace del área privada.

## Diferencias respecto del prototipo (y por qué)

| Prototipo | Implementado | Motivo |
|---|---|---|
| Contadores en Registro/Cobros y tarjeta «En curso» en la barra lateral | No están | Requieren consultas nuevas en el shell («Propuesta»). |
| Campana con contador en la barra superior/del escritorio | No está | Panel de notificaciones = «Propuesta»; hoy la campana sólo existe dentro de Inicio. |
| Botón flotante «Nueva clase» (móvil) | No está | Depende de pantallas del Bloque 2–4. |
| Botones de 36 px (`sm`) | 44 px | B8: objetivo táctil mínimo. |
| Landing: botón secundario «Ya tengo cuenta» | «Empezar» va a `/crear-cuenta` (decisión de Joaquín); sin «Ya tengo cuenta» | «Iniciar sesión» ya está visible en el encabezado. |
| Landing: tarjeta «Hoy» con nombres y datos ficticios | Agenda genérica sin nombres | No inventar personas en una pantalla pública. |
| Panel de marca con textos nuevos | Reusa los textos de la landing | No introducir copy nuevo. |
| Íconos de estado distintos por categoría de enlace vencido/inválido/sin conexión | Dos tonos (aviso / error) según `describeAuthErrorScreen` | El producto sólo distingue dos tonos. |
| Hint «¿Todavía no tenés cuenta?» con enlace dentro de un aviso | Igual | — |
| Iconos de iconografía lavanda/salvia para funciones de la landing | Tonos de avatar y de estado (no `pastelLavender`/`pastelSage`) | Esos tokens son exclusivos del plan 50/30/20. |
| `statusSinDatos` `#6B7078` | `#655B4D` | Contraste 4,5:1 sobre el papel cálido. |

## Compatibilidad con pantallas aún no migradas

Las pantallas de los Bloques 2–6 heredan las superficies, bordes, sombras, texto y la tipografía nueva (por los tokens), pero conservan sus botones y enlaces de **azul de marca** (`brandBlue`) hasta migrar. Es una transición esperada, no un defecto.

## Verificación

- `typecheck`, `lint` y `build` sin errores.
- Suite completa: **1114/1114** (línea base: 1103; +11 pruebas nuevas de tokens, contraste, componentes y alcance), corrida sobre copia LF por el fallo conocido de CRLF en una prueba de fechas.
- Pruebas de B8 vigentes; se actualizaron sólo las que fijaban valores visuales del diseño anterior (breakpoint `md`, azul del foco, clases literales), conservando lo que verifican (foco, 44 px, roles, teclado, contraste).
- Verificación visual a 1440, 390 y 320 px: sin desborde horizontal en ninguna pantalla capturada.
- Pendiente de revisión en dispositivo real: gestos y teclado virtual en la hoja inferior del menú de cuenta.
