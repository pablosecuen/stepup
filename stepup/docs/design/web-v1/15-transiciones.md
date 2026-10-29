# 15 · Sistema único de transiciones del área privada

Una sola curva, tres duraciones y ningún efecto permanente. Todo vive en `app/globals.css` (sección «Sistema único de transiciones») y dentro de
`@media (prefers-reduced-motion: no-preference)`: con «reducir movimiento» el contenido aparece ya en su lugar y diálogos y menús se cierran en el acto.

| Qué | Cómo | Duración |
|---|---|---|
| Pantalla nueva | Todo contenedor `PAGE_WIDTH` lleva `.tf-screen`: sus hijos directos entran como Inicio (opacidad + 10 px, `cubic-bezier(.16,1,.3,1)`, sin rebote) en tres grupos —1.º encabezado, 2.º cuerpo, 3.º en adelante paneles— a 0 / 40 / 80 ms. `ScreenReveal` (layout privado) pone `data-tf-revealed` al terminar y desde ahí nada dentro de la pantalla vuelve a animar al insertarse (escribir, filtrar, guardar). Lo que no usa `PAGE_WIDTH` (errores, avisos) conserva la entrada de raíz: `.tf-page-main > *` | 220 ms |
| Grupos de una pantalla (Inicio) | `.tf-enter` + `data-enter="1\|2\|3"` (encabezado → principal → paneles) y `data-tf-groups` en la raíz | 0 / 40 / 80 ms de retraso (total ≤ 300 ms) |
| Contenido que cambia sin cambiar de pantalla (pestañas del perfil, semana/día del Calendario, **página** de resultados de Alumnos: escribir, filtrar y ordenar NO animan) | `<EnterOnChange changeKey>`: Web Animations sobre el mismo bloque, sin remontar (se conservan foco, scroll y estado) | 220 ms |
| Diálogo (escritorio) | `.tf-dialog`: opacidad + escala 0,98 → 1; fondo `bg-ink/40`; cierra más rápido | 180 ms / 110 ms |
| Hoja móvil | `.tf-dialog` por debajo de 820 px: sube 28 px con opacidad; cierra más rápido | 220 ms / 130 ms |
| Menús y selectores propios | `.tf-menu`: opacidad + escala desde el borde superior (cierra al instante) | 160 ms |

Reglas: sólo `opacity` y `transform` (compuestas por la GPU); sin temporizadores (el único `setTimeout` es la red de seguridad de 260 ms del cierre
animado del diálogo, que nunca retrasa un cierre normal); sin paralaje; el esqueleto de carga (`data-tf-skeleton`) aparece al instante y no se anima;
la barra lateral, la navegación móvil y la fila de sesión son hermanas de `<main>`: nunca se vuelven a animar.

## Diálogos
`Dialog` anima la salida cuando el cierre lo inicia él mismo (Escape, «Cerrar», fondo). Cuando quien lo abrió lo desmonta (p. ej. el botón «Cancelar» del pie
o tras guardar) el cierre es inmediato, sin demora. Foco inicial, foco atrapado, Escape y devolución del foco no cambian; al bloquear el scroll de fondo se
reserva el ancho de la barra de desplazamiento para que el contenido de atrás no se mueva.

## Esqueletos
`PageSkeleton` tiene siete variantes (`list`, `calendar`, `finance`, `profile`, `form`, `settings`, `detail`) con el mismo contenedor (`PAGE_WIDTH`) y las
mismas alturas que la pantalla final. Hay un `loading.tsx` por ruta con página (incluidas las anidadas: perfil, edición, formularios, series, disponibilidad, información, consistencia, tutorial, condiciones, planes, resultado del pago y comportamiento de pago); una prueba obliga a que toda página nueva traiga el suyo (con `width` cuando su ancho no es el de la variante).
**Inicio no tiene `loading.tsx`** (su redirect de recuperación de sesión, B0, debe seguir siendo un redirect HTTP real del servidor).

## Precarga por intención (sigue apagada la precarga automática)
`PrivateLink` mantiene `prefetch={false}` (B0). Sólo precarga el esqueleto de una ruta frecuente cuando hay intención real: puntero posado, foco de teclado
visible o apoyo del dedo/botón (`lib/nav/intent-prefetch.ts`): lista cerrada de secciones con `loading.tsx`, nunca en los primeros 3 s de la página, una vez
por destino cada 60 s y nunca con «ahorro de datos». Así el clic muestra la estructura de la pantalla sin esperar al servidor.
