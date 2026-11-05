# Integración de Series y miembros desplegables — 05/11/2026

## Bloques integrados

- Claude: `4d159a7`, rama local `series-acciones-20261105`, encontrada en `C:/Users/joaqu/tf-web-ser`. Estaba terminada y limpia, pero no publicada. Se integró mediante merge, conservando el historial.
- Codex: `3a377f2`, selector mensual sin celdas superpuestas y ayuda trasladada a Información.
- Elección posterior del usuario: segunda propuesta, «Miembros desplegables», implementada en el detalle compartido por Inicio y Calendario.

## Detalle grupal

- Resumen de fecha, horario, modalidad, estado y duración en dos líneas, sin una colección de chips.
- «N miembros» cerrado por defecto; al abrirlo, cada persona tiene un acceso compacto a su propia ficha. Una clase individual conserva «Ver alumno».
- Los identificadores y nombres se resuelven juntos a partir del mapa de alumnos: no se emparejan listas filtradas por posición. Se conservan dos personas con el mismo nombre y se omiten referencias desconocidas.
- Se conservan Reprogramar solo esta clase, Administrar miembros, Cancelar con confirmación, Administrar serie dentro de Más opciones y Registrar/Editar registro según el estado.
- Diálogo compacto en las acciones y ancho suficiente al abrir la reprogramación. Cerrar ocupa su contenido.

## Revisión del bloque de Claude

Con 26 series sintéticas, 375/390/430/1366 px, se verificaron tarjetas compactas, nombres largos, menú jerarquizado, apertura de Cambiar horario y devolución del foco al cerrar. El menú conservó la cuota de entrenamiento como opción contextual.

Se encontró un defecto al reducir la altura a 420 px: el menú se abría con su parte superior a -142 px. Se corrigió limitando su alto al espacio disponible y montándolo en el documento, para evitar el recorte y los contenedores transformados. Repetida la prueba: límite superior 8 px, con desplazamiento dentro del menú.

El detalle grupal se verificó en esos cuatro anchos: miembros cerrados inicialmente, tres accesos con identificadores distintos al desplegar, sin desborde horizontal y cierre por Escape. Se conservaron las transiciones de nombres mediante los atributos compartidos de la navegación.

Capturas y scripts: `output/review-20261105/`, fuera del repositorio. Ruta temporal retirada antes del build. Datos sintéticos; no se guardaron operaciones ni se usó la cuenta real. No representa una prueba física de iPhone ni una validación autenticada de escrituras en producción. No requiere migraciones.
