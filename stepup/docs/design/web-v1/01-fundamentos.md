# 01 · Fundamentos: tokens, tipografía, espacio, forma y foco

Fuente única de los valores:

- **Variables CSS** `--tf-*` en `app/globals.css` (`:root`).
- **Tailwind** `tailwind.config.ts` (`theme.extend.colors`, `fontFamily`, `borderRadius`, `boxShadow`, `screens`). Los colores se mantienen como hexadecimales (las pruebas de contraste de B8 los leen), espejados 1:1 con las variables; `lib/ui/__tests__/design-tokens.test.ts` falla si dejan de coincidir.

Contraste: todo texto ≥ 4,5:1 sobre `background`, `surface` y `surface2`; controles y foco ≥ 3:1 (WCAG 1.4.3 / 1.4.11). Las razones están verificadas por pruebas, no sólo por inspección.

## 1. Color

### 1.1 Superficies y texto

| Token Tailwind | Variable | Valor | Uso |
|---|---|---|---|
| `background` | `--tf-paper` | `#F6F0E5` | Fondo de página (papel cálido). Nunca gris. |
| `paperDeep` | `--tf-paper-deep` | `#EFE6D4` | Fondos hundidos: esqueletos, pestañas inactivas, hover de acciones fantasma. |
| `surface` | `--tf-surface` | `#FFFDF8` | Tarjetas, campos, menús, diálogos. |
| `surface2` | `--tf-surface-2` | `#FAF4E8` | Encabezados de tabla, filas con hover, bloques secundarios. |
| `border` | `--tf-line` | `#E6DAC4` | Bordes de tarjetas y separadores. |
| `borderMid` | `--tf-line-mid` | `#CDBE9F` | Borde de botones secundarios y de tarjetas interactivas. |
| `borderStrong` | `--tf-line-strong` | `#8E8369` | Borde de **controles de formulario** (3,3:1 sobre el fondo, 3,7:1 sobre la superficie). |
| `textPrimary` / `ink` | `--tf-ink` | `#1C1812` | Texto principal; botón primario. 15,6:1 sobre el fondo. |
| `textSecondary` | `--tf-text-2` | `#4B4337` | Texto de apoyo. 8,6:1. |
| `textMuted` | `--tf-muted` | `#655B4D` | Ayudas, metadatos. 5,9:1 sobre el fondo. |
| `ivory` | — | `#F2EEDF` | Color del logo (sin cambios). |

### 1.2 Barra lateral oscura

| Token | Valor | Uso |
|---|---|---|
| `side` | `#1F1A14` | Fondo de la barra lateral y del panel de marca de las pantallas de acceso. |
| `side2` | `#2C251C` | Hover, tarjetas dentro de la barra. |
| `sideActive` | `#34291D` | Destino activo. |
| `sideLine` | `#3A3126` | Separadores dentro de la barra. |
| `sideText` | `#D2C8B5` | Texto de la barra (10,4:1). |
| `sideMuted` | `#A89E8B` | Texto secundario de la barra (6,5:1). |
| `sideAccent` | `#E58A5F` | Marca del destino activo (6,7:1 sobre la barra). |

### 1.3 Acento y tonos de estado

Un solo acento: terracota. Se usa en la acción principal de la cuenta, los estados activos y los sellos; **no** como color de datos.

| Token | Valor | Uso |
|---|---|---|
| `accent` | `#B4461E` | Botón de acento (texto blanco 5,5:1), indicadores activos. |
| `accentDark` | `#953815` | Hover del acento; texto-enlace sobre papel (6,5:1). |
| `accentSoft` | `#F6DCCB` | Fondo de insignias y píldora activa. |
| `accentText` | `#7A2C0E` | Texto sobre `accentSoft` (7,3:1). |
| `accentLine` | `#E9B79D` | Borde sobre `accentSoft`. |

Tonos de estado (siempre **texto + ícono + tono**, nunca sólo color). Cada uno trae `base` / `Soft` / `Line`:

| Tono | base | Soft | Line | Significa |
|---|---|---|---|---|
| `ok` | `#2F5736` | `#DCEADB` | `#B9D3B8` | Correcto, completado. |
| `warn` | `#6B4700` | `#FBEBC6` | `#E6C873` | Atención, falta algo. |
| `bad` | `#962A20` | `#F9DEDA` | `#E9AFA8` | Error, acción destructiva. |
| `info` | `#1F4D63` | `#D8E8F0` | `#B0CDDB` | Información neutra. |

### 1.4 Tokens heredados que se conservan (no se renombran ni se tocan)

`brandBlue #0A64D2` / `brandBlueDark #004BA8` (azul «en vivo» y estados de las pantallas todavía no migradas), `statusVerde`, `statusAmarillo`, `statusNaranja`, `statusRojo`, `statusPendiente` (semáforo de cobro: **reservados**, no se usan para otra cosa), `statusSinDatos` (pasa de `#6B7078` a `#655B4D` para llegar a 4,5:1 sobre el papel cálido), `pastelLavender*` y `pastelSage*` (plan 50/30/20, exclusivos). La escala del calendario vive en `lib/calendar-theme.ts` y **no** pasa por estos tokens.

**Dos significados del azul (decisión del Bloque 1):**

| Uso | Token | Destino |
|---|---|---|
| Azul heredado como **estilo de interfaz** (botones, enlaces, foco, pastillas activas, fondos de acento) | `brandBlue` / `brandBlueDark` | **Se retira**: cada bloque lo reemplaza al migrar su pantalla (terracota/tinta). No se reemplaza globalmente. |
| Azul con **significado de dato o categoría**: «Necesidades» del plan 50/30/20 (control y cifra) | `dataNeeds` (`--tf-data-needs`, mismo valor `#0A64D2`) | **Se conserva**. Es un token aparte para que el retiro del azul de interfaz no lo arrastre. Los otros dos renglones del plan siguen con lavanda y salvia. |

Al migrar una pantalla, si un azul expresa un dato o una categoría (no un estado de interfaz), se pasa a un token de dato propio y se documenta acá.

### 1.5 Avatares de alumnos (tonos cálidos)

Seis tonos para el círculo con iniciales (en serifa). Se asigna por un hash estable del identificador del alumno.

| Tono | Fondo | Texto |
|---|---|---|
| 0 | `#F8DCCB` | `#7A2C0E` |
| 1 | `#FBEBC6` | `#6B4700` |
| 2 | `#DCEADB` | `#2F5736` |
| 3 | `#E9E2FF` | `#4D3B77` |
| 4 | `#F7D9DD` | `#7A2A3A` |
| 5 | `#D8E8F0` | `#1F4D63` |

## 2. Tipografía

Cargadas con `next/font/google` (autoalojadas: no hay pedidos a Google en tiempo de ejecución; CSP `font-src 'self'` se cumple).

| Rol | Familia | Variable CSS | Tailwind |
|---|---|---|---|
| Interfaz | Hanken Grotesk (400–800) | `--font-sans` | `font-sans` (base de toda la app) |
| Títulos, cifras grandes, nombres | Fraunces (variable, eje `opsz`) | `--font-display` | `font-display` |

Escala:

| Estilo | Tamaño / interlínea | Peso · tracking | Notas |
|---|---|---|---|
| Hero (landing) | 62/1,03 (42 en móvil, 36 a 320 px) | Fraunces 400 · −0,035em | La palabra clave va en cursiva con `accentDark`. |
| H1 de página | 38/1,08 (30 en móvil, 26 a 320 px) | Fraunces 500 · −0,025em | |
| H1 de acceso | 34/1,1 (30 en tarjeta centrada) | Fraunces 500 | |
| H2 de sección | 24/1,2 | Fraunces 500 | |
| H3 / título de tarjeta | 19/1,25 | Fraunces 600 | |
| Nombre de alumno en lista | 18/1,25 | Fraunces 600 | |
| Cuerpo | 15/1,5 | Hanken 400 | |
| Cuerpo pequeño / ayuda | 13,5/1,45 | Hanken 400–500 | |
| Rótulo | 12 en mayúsculas, +0,12em | Hanken 700 | `text-textSecondary`. |
| Cifras e importes | `tabular-nums lining-nums` | | Horarios, importes y contadores. |

Reglas: los títulos largos se parten (`overflow-wrap: anywhere` ya es global); nunca texto de interfaz en serifa por debajo de 16 px, salvo iniciales de avatar.

## 3. Espaciado

Escala de 4 px (la de Tailwind): 4, 8, 12, 16, 24, 32, 48. Rellenos de página: 40 px lateral en escritorio, 16 px en móvil (12 px a 320 px). Contenido: 1180 px como máximo (960 para formularios largos, 760 para formularios, 1320 para el calendario). Hueco entre tarjetas: 12–20 px.

## 4. Radios, bordes y sombras

| Token | Valor | Uso |
|---|---|---|
| `rounded-sm` | 8 px | Chips, controles pequeños. |
| `rounded-md` | 12 px | Botones, campos, menús internos. |
| `rounded-lg` | 16 px | Tarjetas. |
| `rounded-xl` | 22 px | Diálogos, tarjetas de acceso. |
| `rounded-pill` | 999 px | Píldoras, avatares, insignias. |

Bordes: **1,5 px** en tarjetas y controles (`border-[1.5px]`), 1 px en separadores internos.

| Token | Valor | Uso |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(60,40,10,.06), 0 8px 20px -14px rgba(60,40,10,.22)` | Tarjetas. |
| `shadow-cardHover` | `0 2px 4px rgba(60,40,10,.08), 0 16px 28px -14px rgba(60,40,10,.26)` | Tarjetas interactivas al pasar. |
| `shadow-panel` | `0 24px 56px -18px rgba(40,25,5,.38), 0 2px 6px rgba(40,25,5,.08)` | Menús, diálogos. |
| `shadow-subtle` | `0 1px 2px rgba(60,40,10,.06)` | Pastillas y segmentos. |

Sombras muy suaves y cálidas (tintadas de marrón, nunca negro puro).

## 5. Movimiento

Transiciones de 120–180 ms (`ease-premium`); diálogos y hojas entran con fundido + desplazamiento corto. `prefers-reduced-motion` reduce todo a ~0 (regla global ya existente). Los giros de carga se detienen con «reducir movimiento».

## 6. Foco y accesibilidad (se preserva B8)

- **Foco global**: `:focus-visible { outline: 2.5px solid #1C1812; outline-offset: 2px }` (15,6:1 sobre el papel). Sobre fondos oscuros (barra lateral, panel de marca) el anillo es marfil `#F6F0E5` (15:1).
- Los campos, además, sombrean el foco con `0 0 0 3px rgba(180,70,30,.28)` y oscurecen el borde.
- Objetivos táctiles ≥ 44 px (regla global de `globals.css` intacta: campos, selectores, botones, resúmenes, casillas; sólo se exceptúa el bloque horario del calendario).
- «Saltar al contenido» sigue siendo el primer elemento enfocable; cada `<main id="contenido" tabIndex={-1}>` es su destino.
- Roles, `aria-current`, `aria-label` y nombres accesibles de la navegación, el menú de cuenta y los formularios se conservan tal cual.
- Un estado importante nunca se comunica sólo con color: ícono + texto.
- Texto de marcador de posición (`placeholder`) ≥ 4,5:1 (`#7D7260`).
