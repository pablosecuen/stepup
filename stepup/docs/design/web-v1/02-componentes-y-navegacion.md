# 02 · Componentes base, navegación y comportamiento responsive

Los componentes viven en `components/ui/`. Cada pantalla los usa en lugar de repetir cadenas de clases. Se migran por bloques; hasta que una pantalla migra conserva su marcado actual (que ya hereda los tokens nuevos de superficie, texto y borde).

## 1. Breakpoint

| Nombre | Valor | Qué cambia |
|---|---|---|
| (base) | < 820 px | Navegación móvil (barra superior + inferior), diálogos y menús como **hojas inferiores**, formularios de una columna, tablas como tarjetas. |
| `nav:` | ≥ 820 px | Barra lateral de 236 px, diálogos centrados, menús desplegables, tablas. |
| `sm:` / `md:` / `lg:` | 640 / 768 / 1024 | Los de Tailwind, para la rejilla interna de cada pantalla. |

Anchos de verificación obligatorios: **320**, **390** y **1440** px. Sin desborde horizontal en ninguno.

## 2. Botones

`Button` (elemento `<button>`) y `ButtonLink` / `PrivateButtonLink` (enlaces con aspecto de botón) comparten `buttonClass()`.

| Variante | Fondo · texto · borde | Uso |
|---|---|---|
| `primary` | `ink` · marfil · `ink` | Acción principal por defecto. |
| `accent` | `accent` · blanco · `accent` | Llamada principal de la cuenta (landing, «Empezar»). Una por pantalla. |
| `secondary` | `surface` · `ink` · `borderMid` (hover: borde `ink`) | Acciones secundarias. |
| `ghost` | transparente · `textSecondary` (hover: `paperDeep`) | Acciones terciarias («Cancelar», «Volver»). |
| `danger` | `bad` · blanco | Confirmación destructiva. |
| `dangerOutline` | transparente · `bad` · borde `bad` | Acción destructiva no confirmada. |

Tamaños: **md** (44 px de alto, 14,5 px, peso 650) y **lg** (52 px, 16 px). No existe tamaño por debajo de 44 px: el prototipo dibujaba botones de 36 px (`sm`) y se corrigen a 44 para cumplir B8. Estados: hover, `active` (escala .98), `disabled` (opacidad .5, sin eventos), ocupado (`aria-busy` + giro). Enlace de texto: `LinkText` (acento oscuro, subrayado al pasar, 44 px).

## 3. Campos

`Field` agrupa etiqueta (arriba, 14 px, peso 650), control, ayuda (13 px, `textMuted`) y error (13 px, `bad`, ícono + texto, `role="alert"` cuando aparece). `inputClass` aplica: alto 46 px, relleno 14 px, radio 12, borde 1,5 px `borderStrong`, fondo `surface`, hover con borde `ink`, foco con borde `ink` + halo terracota, error con borde `bad`, deshabilitado con fondo `paperDeep`. La etiqueta se asocia por `htmlFor`/`id` (nunca sólo placeholder). Los selectores traen su flecha propia.

Casillas y opciones: casilla de 22 px (borde `borderStrong`, relleno `ink` al marcar) y opciones tipo píldora (`aria-pressed`, relleno `ink` al activarse); el objetivo táctil es la etiqueta entera (44 px).

## 4. Tarjetas, avisos, insignias, avatares

- **Tarjeta**: `surface`, borde 1,5 px `border`, radio 16, `shadow-card`; variante plana sin sombra; tonos (`warn`, `bad`, `ok`) con fondo tintado y borde del tono.
- **Aviso** (`Notice`): ícono + texto, tono `info | ok | warn | bad`; los errores usan `role="alert"`, la información `role="status"`.
- **Insignia** (`Badge`): píldora de 26 px con ícono o punto + texto; mismos cuatro tonos más `accent` y `neutral`.
- **Avatar**: círculo con iniciales en Fraunces y uno de los seis tonos cálidos (`01-fundamentos.md` §1.5); tamaños 28/36/40/48/72.

## 5. Tablas

Encabezado en mayúsculas pequeñas (12 px, +0,08em, `textMuted`) sobre `surface2`; filas de ≥ 54 px, separador de 1 px, hover `surface2`; importes alineados a la derecha con numerales tabulares. Bajo 820 px una tabla «apilable» muestra cada fila como tarjeta (encabezado oculto). Siempre dentro de un contenedor con scroll horizontal accesible si hace falta.

## 6. Menús desplegables

Panel `surface`, borde 1,5 px `borderMid`, radio 16, `shadow-panel`. Elementos de 48 px (56 px en móvil) con ícono de 20 px; hover `paperDeep`; un separador de 1,5 px antes de las acciones destructivas. Patrón **menu button** de WAI-ARIA sin cambios (`role="menu"`/`menuitem`, flechas, Inicio/Fin, Escape devuelve el foco).

## 7. Diálogos y hojas móviles

`Dialog`: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, `tabIndex={-1}`, comportamiento de `useDialogA11y` (Escape, foco atrapado, devolución del foco, página de fondo sin scroll). Fondo atenuado `ink/50`.

| Ancho | Forma |
|---|---|
| ≥ 820 px | Centrado, 560 px (440 confirmaciones, 680 contenido largo), radio 22, `shadow-panel`. |
| < 820 px | **Hoja inferior**: pegada abajo, ancho completo, radio superior 24, asa de 44×5, máx. 92 vh con scroll interno, acciones en columna (la principal primero) y relleno inferior con la zona segura. |

Título en Fraunces 23 px; cuerpo con separación de 14 px; botón de cerrar de 44 px con `aria-label`.

## 8. Estados globales

| Estado | Diseño |
|---|---|
| Carga (`PageSkeleton`) | `role="status"` + `aria-busy`, texto sólo para lectores, bloques `paperDeep` con brillo (se apaga con «reducir movimiento»); mantiene la forma de la pantalla (cabecera + 3 tarjetas). |
| Vacío (`EmptyState`) | Borde discontinuo 2 px `borderMid`, ilustración circular con ícono sobre `accentSoft`, título en Fraunces, texto y **una** acción. |
| Error en línea (`ErrorState`) | Aviso `bad` con ícono, `role="alert"`. |
| Error de ruta (`RouteErrorView`) | Pantalla central: círculo `badSoft` con ícono, «Algo salió mal», `Reintentar` + `Ir a Inicio`. Nunca muestra el mensaje del error. |
| No encontrado (`NotFoundView`) | «404» en Fraunces con `accent`, título, texto y un camino de vuelta. |

## 9. Navegación

### 9.1 Escritorio (≥ 820 px)

Barra lateral fija de 236 px, fondo `side`:

1. Marca (logo + «TeacherFlow» en Fraunces 20) — enlaza a `/inicio`.
2. Los **cinco destinos** (Inicio, Alumnos, Calendario, Cobros, Registro), 46 px, 15 px; ícono outline, sólido cuando está activo. Activo: fondo `sideActive`, texto blanco en negrita, barra de 4 px `sideAccent` pegada al borde izquierdo. `aria-current="page"` por segmento completo (`isPrimaryNavActive`, sin cambios).
3. Espacio flexible.
4. **Bloque de cuenta** (botón de 56 px): avatar con inicial, nombre en Fraunces 16, correo en 12,5 px, chevron. Abre el menú de cuenta hacia arriba.

La barra lleva el foco visible en marfil. El contenido va con `padding-left: 236px`.

**Fuera de este diseño por ahora** (requieren datos nuevos): contadores en Registro/Cobros y la tarjeta «En curso» de la barra lateral. Ver `04-propuestas-y-limites.md`.

### 9.2 Móvil (< 820 px)

- **Barra superior** (58 px, fija, fondo `background` sin desenfoque): marca a la izquierda, botón de cuenta (avatar de 40 px, objetivo de 44) a la derecha.
- **Barra inferior** (fija, `surface`, borde superior 1,5 px `borderMid`, relleno con zona segura): los mismos cinco destinos; 58 px de alto mínimo; ícono de 24 px dentro de una **píldora** de 52×30 que se rellena con `accentSoft` + `accentText` cuando está activa; etiqueta de 11,5 px (10,5 px a ≤ 360 px). `aria-current="page"`.
- El contenido deja espacio inferior para la barra (`pb-[calc(4.5rem+env(safe-area-inset-bottom))]`).
- **Sin** botón flotante ni campana en la barra superior en el Bloque 1: ambos dependen de pantallas y datos de bloques posteriores.

### 9.3 Menú de cuenta

Contenido real (sin cambios): nombre y correo, **Configuración** (enlace), **Cerrar sesión** (botón, acción existente `requestSignOut` con `guardNetwork`; muestra el error en línea). Diseño: cabecera sobre `surface2` con avatar de 48 px y el nombre en Fraunces 18; elementos de 48 px; «Cerrar sesión» en tono `bad` tras un separador.

- Escritorio: panel de 292 px que se abre hacia arriba desde el bloque de cuenta.
- Móvil: **hoja inferior** con fondo atenuado y asa; elementos de 56 px; se cierra con Escape, tocando el fondo o al navegar.

## 10. Pantallas de acceso y landing

- **Landing** (`/`): cabecera con marca y «Iniciar sesión»; héroe en dos columnas (texto + tarjeta ilustrativa «Hoy» sin datos reales) que pasa a una columna en móvil; tres tarjetas de funciones con ícono sobre un tono propio (alumnos: lavanda, calendario: terracota, cobros: salvia); pie.
- **Acceso** (`/login`, `/crear-cuenta`, `/recuperar-contrasena`): en escritorio, **dos mitades**: panel de marca `side` (marca, titular, tres puntos de valor) y formulario sobre papel; en móvil, sólo el formulario con la marca encima.
- **Estados de enlace y confirmación** (`/auth/confirm`, `/auth/confirmado`, `/auth/error`, `/nueva-contrasena`, `/iniciando-sesion`): tarjeta centrada de 440 px con marca, círculo de estado de 72 px (ícono + tono) y un único camino principal.
