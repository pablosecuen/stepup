# Calendario en el teléfono — cinco días fijos, clases cortas y límites conocidos (11/11/2026)

Escritorio (≥ 820 px) no cambia. Todo lo de abajo vale por debajo de 820 px.

## Geometría

- **Semana:** cinco días completos de igual ancho (lunes a viernes) y sábado/domingo se alcanzan deslizando; cabecera y cuerpo usan las mismas pistas (`mobileFiveDayTracks`). Las barras visuales de desplazamiento están ocultas (`scrollbar-width: none`, sólo dentro del área privada y por debajo de 820 px); el desplazamiento nativo, el toque y el zoom siguen igual.
- **Día:** encabezado «Miércoles 11». Una clase sola mide como máximo 244 px de ancho y escribe el nombre en 16 px.
- La hora no se repite dentro de la tarjeta (está en la columna horaria y en el nombre accesible).
- La posición vertical **y horizontal** se guarda al salir de la grilla (hueco libre → «Nueva clase», o cualquier enlace del detalle) y se restituye una sola vez al volver (`grid-scroll.ts`). Abrir una clase, guardar o cancelar no remonta la grilla, así que no se mueve; al cambiar de semana se vuelve al lunes a propósito.

## Dónde se escribe el nombre (`lib/calendar/mobile-short-labels.ts`, puro)

1. Si el nombre entero, en palabras completas, entra en el bloque (con su estado «Cancel.»/«Reprog.»/«Reemp.» en su propia línea) se escribe dentro. El bloque conserva siempre la hora y la duración reales: nunca se inventa una altura.
2. Si no entra, la clase pasa a **barra exacta + rótulo** al costado. Barra de 6 px (clase sola o consecutiva) u 8 px por carril (simultáneas); el rótulo usa 2 px de borde y 3 px de relleno. El rótulo parte el nombre en palabras (hasta tres líneas en Semana) en letra de 11 px y baja a 10 px —nunca menos— sólo si la palabra más larga no entra a 11. Puede ser más alto que la barra y se acomoda sin tapar otras clases (programación dinámica con alto propio por rótulo). Si no hay lugar sin tapar una clase larga, esa clase pasa también a barra + rótulo: nada se oculta ni se tapa.
3. **Cada grupo tiene su propia geometría**: un grupo de tres simultáneas ya no le quita ancho al rótulo de una clase sola ni de un grupo de dos del mismo día.
4. Un grupo de clases simultáneas se numera en la barra y en el rótulo. Un grupo con alguna clase que no entra pasa entero a barras numeradas.
5. Todo recorte lleva «…». Una palabra nunca se parte por letras. Sólo en el caso físicamente imposible de abajo, el grupo simultáneo muestra el comienzo de la primera palabra o las iniciales, parejo para todo el grupo, y **se informa como caso abierto**.

## Medición: cuánto ancho de columna necesita cada nombre

Columna de la Semana del teléfono: 68 px (375), 71 px (390), 79 px (430). Ancho mínimo para que la **primera palabra** entre entera (estimador de la app, letra 11/10 px, con el margen de seguridad):

| Primera palabra | 1 carril (clase sola/consecutiva) 11 px / 10 px | 2 carriles simultáneos (con barras y número) 11 px / 10 px | 3 carriles 11 px / 10 px |
|---|---|---|---|
| Ana | 38 / 36 | 60 / 58 | 68 / 66 |
| Camila | 56 / 52 | 78 / **74** | 86 / 82 |
| Valentina, Alejandro, Florencia | 70 / **65** | 92 / **87** | 100 / **95** |
| Guadalupe | 77 / 71 | 99 / 93 | 107 / 101 |
| Maximiliano | 87 / 80 | 109 / 102 | 117 / 110 |

Lectura: una clase **sola o consecutiva** ya muestra «Valentina», «Alejandro», «Florencia» entera en 375, 390 y 430 px (antes salía «Valent…»). Para **2 clases al mismo horario** una columna de 68–79 px sólo alcanza para nombres de hasta ≈ 5–6 letras (a 430 px, «Camila»); con «Valentina» harían falta ≈ 87 px, y con 3 simultáneas ≈ 95 px. No se resuelve cambiando letra, bordes ni barras: ya están al mínimo legible.

## Casos que NO caben (límite físico, sin resolver)

Con **cinco días iguales + duración exacta + barras al lado**, 2 o más clases simultáneas con nombres largos no caben a 375–390 px. Hoy se dibujan numeradas con el comienzo del nombre («Vale…») o iniciales parejas («IC», «JV», «KL»), y el nombre completo está en el detalle y en la vista **Día**. Eso NO se da por resuelto. Propuestas (la elección es de Joaquín; ninguna se implementó):

1. **Lista del grupo (recomendada).** Un toque en el número/rótulo de un grupo simultáneo abre una lista compacta «A esta hora: 1 Valentina Pons 11:00–12:00 · 2 Camila Quince 11:00–12:00» con cada fila tocable para abrir la clase. Un toque por grupo (no por clase); no cambia columnas ni duraciones.
2. **Día con nombres completos** (ya existe): un toque en el encabezado del día muestra a todas con nombre completo (verificado: «Irene Campos», «Julian Vera», «Karen Luna» a 390 px). No agrega nada nuevo, pero cuesta un cambio de vista.
3. **Ensanchar sólo la columna del día con simultáneas** (rompe «cinco días iguales»; no recomendada).

## Límites menores conocidos

- Una cadena larga de clases cortas con nombres de 3 líneas hace que los rótulos se desplacen unos píxeles de su barra; el orden vertical se conserva.
- Un nombre de una sola palabra más ancho que ≈ 52 px a 10 px («Maximiliano» en 375 px) se escribe recortado con «…»; un nombre de cinco palabras («María de los Ángeles Fernández Villanueva») usa tres líneas y termina en «…».
- Nada de esto está probado en un iPhone físico ni en Safari.

## Detalle de clase

Las acciones (Registrar esta clase —un enlace—, Reprogramar, Administrar miembros, Cancelar esta clase) comparten alto mínimo de 52 px y ancho completo (`[data-lesson-actions]`, selectores para `button` y `a`); los metadatos de fecha/horario/modalidad se parten en renglones y no se recortan. Sin Cambiar tipo, Cambiar duración ni Volver a fecha original.

## «Hoy» y fecha efectiva (Series)

Fila de 300 px máximo, fecha flexible y botón «Hoy» alineado, en «Editar futuras» y «Administrar miembros». No se tocó ninguna fecha, regla ni validación.

## Doble pantalla al navegar

Ver el informe de la sesión: no se reprodujo en Chromium (una sola `main`, una sola barra y una sola cabecera en todo momento, ninguna transición abortada, ninguna recarga completa). Lo que sí se ve en cualquier navegador es el cruce de ~120 ms entre la pantalla que sale y la que entra. La regla que aísla cabecera y barra fija de la transición es una medida preventiva: **no hay causa confirmada** ni prueba en Safari/iPhone.
