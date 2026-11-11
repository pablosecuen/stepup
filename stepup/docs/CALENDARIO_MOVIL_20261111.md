# Calendario en el teléfono — cinco días fijos, clases cortas y límites conocidos (11/11/2026)

Escritorio (≥ 820 px) no cambia. Todo lo de abajo vale por debajo de 820 px.

## Geometría

- **Semana:** cinco días completos de igual ancho (lunes a viernes) y sábado/domingo se alcanzan deslizando; cabecera y cuerpo usan las mismas pistas (`mobileFiveDayTracks`). Las barras visuales de desplazamiento están ocultas (`scrollbar-width: none`, sólo dentro del área privada y por debajo de 820 px); el desplazamiento nativo, el toque y el zoom siguen igual.
- **Día:** encabezado «Miércoles 11». Una clase sola mide como máximo 244 px de ancho y escribe el nombre en 16 px.
- La hora no se repite dentro de la tarjeta (está en la columna horaria y en el nombre accesible).
- La posición vertical **y horizontal** se guarda al salir de la grilla (hueco libre → «Nueva clase», o cualquier enlace del detalle) y se restituye una sola vez al volver (`grid-scroll.ts`). Abrir una clase, guardar o cancelar no remonta la grilla, así que no se mueve; al cambiar de semana se vuelve al lunes a propósito.

## Dónde se escribe el nombre (`lib/calendar/mobile-short-labels.ts`, puro)

1. Si el nombre entero, en palabras completas, entra en el bloque (con su estado «Cancel.»/«Reprog.»/«Reemp.» en su propia línea) se escribe dentro. El bloque conserva siempre la hora y la duración reales: nunca se inventa una altura.
2. Si no entra, la clase pasa a **barra exacta + rótulo** al costado. El rótulo parte el nombre en palabras (hasta tres líneas en Semana) y puede ser más alto que la barra; se acomoda sin tapar otras clases (programación dinámica con alto propio por rótulo). Si no hay lugar sin tapar una clase larga, esa clase pasa también a barra + rótulo: nada se oculta ni se tapa.
3. Un grupo de clases simultáneas se numera en la barra y en el rótulo. Un grupo con alguna clase que no entra pasa entero a barras numeradas.
4. Todo recorte lleva «…». Una palabra nunca se parte por letras.

## Límites conocidos (no resueltos, a propósito)

- En **Semana** a 375–390 px cada día mide ≈ 68–71 px. Con 2 o más clases simultáneas el rótulo sólo tiene lugar para el número y, con 2 carriles, las iniciales («FT»); con 3 carriles queda sólo el número. El nombre completo está en el nombre accesible, en el detalle (un toque) y en la vista **Día** (tocar la cabecera del día).
- Una cadena de tres o más clases cortas consecutivas con nombres de dos palabras hace que los rótulos (de dos líneas) se desplacen unos píxeles de su barra; el orden vertical se conserva.
- Un nombre de una sola palabra más ancho que ≈ 47 px («Valentina» en 375 px) se escribe recortado con «…».
- Nada de esto está probado en un iPhone físico ni en Safari.

## Detalle de clase

Las acciones (Registrar esta clase —un enlace—, Reprogramar, Administrar miembros, Cancelar esta clase) comparten alto mínimo de 52 px y ancho completo (`[data-lesson-actions]`, selectores para `button` y `a`); los metadatos de fecha/horario/modalidad se parten en renglones y no se recortan. Sin Cambiar tipo, Cambiar duración ni Volver a fecha original.

## «Hoy» y fecha efectiva (Series)

Fila de 300 px máximo, fecha flexible y botón «Hoy» alineado, en «Editar futuras» y «Administrar miembros». No se tocó ninguna fecha, regla ni validación.

## Doble pantalla al navegar

Ver el informe de la sesión: no se reprodujo en Chromium (una sola `main`, una sola barra y una sola cabecera en todo momento, ninguna transición abortada, ninguna recarga completa). Lo que sí se ve en cualquier navegador es el cruce de ~120 ms entre la pantalla que sale y la que entra. La regla que aísla cabecera y barra fija de la transición es una medida preventiva: **no hay causa confirmada** ni prueba en Safari/iPhone.
