# Carga uniforme, Preferencias y Recordatorios compactos — 29/10/2026

Rama `carga-preferencias-recordatorios-20261029`, partida de `0e167a9` (la versión publicada: diseño natural + botones de calificación). **No publicada**: Codex integra este bloque con el suyo (reemplazos duplicados y ancho de tarjetas del Calendario) y hace una sola publicación. No se tocó ningún componente, acción, repositorio, lógica ni migración del Calendario; las únicas piezas dentro de `calendario/` son dos `loading.tsx` nuevos (presentación pura).

## 1 · Carga uniforme
- **Mecanismo compartido, una sola vez.** `PAGE_WIDTH` marca cada pantalla con `.tf-screen` y `globals.css` anima sus hijos directos como Inicio (encabezado → cuerpo → paneles, 0 / 40 / 80 ms, 220 ms, sólo `opacity`/`transform`). `components/nav/screen-reveal.tsx` (montado en el layout privado) espera a las animaciones reales de esos hijos y pone `data-tf-revealed`; desde ahí escribir, filtrar, guardar o un aviso que aparece no vuelven a animar nada. Sin temporizadores. Todo dentro de `prefers-reduced-motion: no-preference`.
- **Esqueletos.** Ocho rutas heredaban el esqueleto de su sección con otro ancho/estructura: ahora tienen el suyo (`calendario/informacion`, `calendario/series/[id]`, `configuracion/consistencia`, `configuracion/tutorial`, `facturacion/condiciones|planes|resultado`, `resumen-financiero/comportamiento-de-pago`). `PageSkeleton` acepta `width` para el caso de una pantalla ancha con estructura de detalle. Una prueba exige `loading.tsx` en toda página privada **salvo Inicio** (su redirect HTTP de recuperación de sesión no se toca).
- **Alumnos.** El resultado sólo entra al cambiar de página; escribir, filtrar u ordenar ya no lo animan de nuevo (antes la clave incluía todos los filtros). Pestañas del perfil y Calendario conservan su patrón.

## 2 · Preferencias
`NavigationPreference` renderizaba su `fieldset` crudo dentro de la tarjeta (el reinicio de estilos lo dejaba a 1 px del borde). Ahora es una `SettingsRow`: relleno 16/20 px de las otras tarjetas y título → explicación → opciones alineadas, con el grupo conservado como `fieldset` + `legend` accesible. La preferencia guardada y la acción no cambian. El único otro bloque que usaba ese componente es esa misma tarjeta; una prueba impide volver a poner contenido sin relleno directo en una `SettingsCard`.

## 3 · Recordatorios
Las filas medían ~1.050 px a 1366. Nuevo `READING_WIDTH` (720 px) en `page-header.tsx`; Recordatorios usa dos columnas desde 1040 px (filas de ~510 px) y una columna acotada por debajo. Nombres largos se parten (nunca se cortan), fechas/importes/orden se conservan, la insignia roja lleva el número escrito + «pendiente(s)» para lectores de pantalla. «Clases por registrar» (Registro) tenía el mismo defecto y usa la misma medida; Cobros es una tabla de columnas y Series un panel con scroll, no se tocaron.

## Verificación
`tsc` y `eslint` sin errores; suite completa **5137 / 5137** (7 pruebas nuevas en `screen-load-preferences-reminders.test.ts` y 3 pruebas de contrato ajustadas: la clase `tf-screen` y `width`); `next build --webpack` compila (aviso previo de `libheif`). Medido en Edge headless contra build de producción con una ruta temporal (ya borrada): esqueleto a ~60 ms, entrada escalonada, sellado a ~300 ms, filtros sin esqueleto ni animación, inserción tardía sin animar, `reduce` sin ninguna animación. Capturas 375 / 390 / 430 / 1366 px antes/después sin desborde horizontal.

## No comprobado
Sin sesión QA en el navegador integrado no se probó contra Production ni contra datos reales (no se tocó ninguna cuenta). No hay prueba física en iPhone/Safari: sólo emulación. La percepción de fluidez real (incluido el esqueleto en red lenta) queda para la revisión de Joaquín.
