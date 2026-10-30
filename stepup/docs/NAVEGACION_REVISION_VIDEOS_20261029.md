# Revisión de navegación a partir de los videos del 29/10

Base: `02ad3fc` (código publicado anterior `9905f92`). Se revisaron los dos MP4 del ZIP: 22,91 y 25,10 segundos. Recorrido completo a dos fotogramas por segundo y ampliación a doce por segundo en los cambios de ficha y gráficos. Las grabaciones de la cuenta real se mantienen fuera del repositorio.

## Defectos observados y corrección

1. Video 1, aproximadamente 10,73–11,32 s: la ficha pasa por el esqueleto de la lista de Alumnos y luego por el del perfil, antes de aparecer y subir. Los límites de carga de una sección también capturan rutas hijas. Ahora `DestinationSkeleton` resuelve el destino real (pendiente o actual), en vez de dibujar siempre la lista del padre. Se aplica a Alumnos, Cobros, Registro, Calendario, Configuración, Finanzas y Facturación.
2. El nombre compartido se copiaba después de que ya llegaba el destino, mientras el encabezado también estaba animándose. Se retira ese clon tardío. El relevo usa `ViewTransition` de la versión instalada de Next/React y nombres estables. La ficha deja fijo su encabezado y sus pestañas, y su cuerpo no recibe dos entradas anidadas. Las fichas UUID sólo se preparan al mostrar intención sobre ese enlace; se conserva la guarda de tres segundos, el límite de repetición y ahorro de datos. No se precargan todas las filas.
3. Video 2, aproximadamente 16,62 s: desaparece el esqueleto y queda momentáneamente el fondo antes de entrar los datos. Un relevo nativo conserva la imagen anterior durante la llegada de la nueva; no compite con la subida CSS anterior. Una respuesta ya disponible evita el esqueleto optimista: se muestra sólo si sigue pendiente a los 100 ms, sin imponer ningún tiempo mínimo de espera al contenido.
4. Video 2, aproximadamente 19,92–20,33 s: la torta aparece completa, se reinicia a segmentos mínimos y crece otra vez. Cambiar Barras/Torta ya no reinicia la animación de los datos. La presentación tiene su relevo local y no anima de nuevo toda la pantalla. Se elimina además la segunda animación del contenedor. La entrada de marcas se prepara antes de pintar en navegación cliente; el HTML que ya fue visible antes de hidratar no vuelve a cero.

## Alcance y comprobación

- No cambia cálculos, importes, tareas, registros, colores, navegación de Cobros ni autenticación. Sin migraciones.
- Sin bibliotecas nuevas. La API usada está documentada en `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` de Next 16.3.8. Navegadores sin esa capacidad conservan la navegación y la entrada CSS; movimiento reducido desactiva la animación.
- Suite final: 5210/5210; compilación final correcta. Se conservan las pruebas de lecturas sin escrituras y aislamiento de cuentas; las guardas estructurales se adaptan al selector real de destino y a la precarga limitada por intención.
- Laboratorio temporal con componentes reales de perfil y gráfico, datos sintéticos y respuestas escalonadas: navegación, llegada posterior del cuerpo y cambio de representación sin errores de navegador. Eliminado antes del build. El tiempo de desarrollo/en segundo plano no se presenta como medición de rendimiento de un dispositivo físico.
- Publicado `a9df1bd0f183713a3a5318856004c982d4ee0f03`, despliegue `dpl_DWkmuvU1Zgpkz5J4NVkELztyhJyT`, READY y asignado a teacherflowapp.com. Una sola publicación, sin migraciones.
- QA de producción: el usuario rehabilitó la sesión del panel. Recorrido Inicio → Alumnos → QA Dos Prueba y Finanzas → Barras/Torta con clics reales. Se inspeccionaron secuencias de capturas: la ficha usa su propio esqueleto, el encabezado queda estable al llegar el cuerpo y la torta no aparece completa para reiniciarse después. Total conservado: $67.800,50. Consola sin avisos ni errores en estos recorridos. No se guardaron formularios, pagos ni registros, y la sesión sigue abierta.
- Evidencia fuera del repositorio: output/navegacion-20261029/alumnos-produccion.mp4 y finanzas-produccion.mp4. Son secuencias de capturas del navegador integrado con sus intervalos reales, no grabaciones de pantalla a 60 fps. Esta comprobación publicada fue en escritorio; no sustituye una prueba táctil ni Safari físico.
- Falta comprobar el resultado en Safari/iPhone físico. No se declara cerrada la paridad ni perfecta la navegación de todos los dispositivos.

