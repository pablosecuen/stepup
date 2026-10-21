# Registro pedagógico: corrección del 21/10/2026

Estado: corrección preparada; la migración y la publicación requieren el paso explícito de aprobación indicado en `WEB_PARITY_PLAN.md`. No equivale a una auditoría completa de paridad.

## Causa comprobada

La aplicación original (`PedagogicalContentSection.tsx` y `RegisterPendingClassSheet.tsx`) permite cargar temas planificados/vistos, objetivos, actividades y notas de actividades. La web importaba esos datos, pero `LessonContentCard` sólo los leía. `RegistrationWorkspace`, las acciones de finalizar/editar y sus RPC no aceptaban ese contenido. Comparar cantidades y campos importados no detectó la ausencia del flujo de escritura.

## Corrección

- Editor compartido entre registro del calendario y clase no programada; también se usa al editar clases finalizadas.
- Temas: agregar, corregir, eliminar y marcar planificado/visto. Objetivos y actividades: agregar, corregir y eliminar. Notas de actividades y observación interna: texto libre.
- Guardado del contenido sin finalizar la clase. Finalizar y editar guardan el contenido dentro de la transacción existente. La edición conserva el snapshot anterior y la idempotencia de la operación.
- La carga reutiliza el lector existente; la ausencia de contenido produce un editor vacío, no una sección inaccesible.
- No se modifican materiales ni adjuntos existentes. Su visualizador sigue disponible. **Esta corrección todavía no incorpora la carga/edición de archivos y biblioteca de materiales del móvil.**
- Las selecciones de tareas anteriores permanecen visibles al resolver la última tarea, para poder revisarlas antes de guardar.

## Publicación y comprobación

1. Aplicar únicamente la nueva migración `20261022000000_restore_pedagogical_registration.sql` (sin cambios masivos de filas históricas).
2. Publicar los archivos de código de esta corrección. Debe aplicarse SQL antes de publicar: el nuevo botón de borrador necesita la nueva RPC.
3. Con una cuenta QA, verificar crear → guardar borrador → reabrir → finalizar → editar → reabrir; comprobar temas, actividades y notas. Revisar también una clase grupal y una no programada.
4. Verificar con la profesora la pantalla real. No declarar paridad total hasta cubrir los demás flujos y las funciones aún pendientes.

La prueba `supabase/tests/postgres/pedagogical_content_rehearsal.cjs` ejecuta los serializadores/lectores de la aplicación y las RPC contra PostgreSQL aislado, con propietarios y registros sintéticos. Incluye aislamiento por cuenta, rechazo de anónimos, rollback de contenido/historial ante errores, idempotencia de edición, eliminación explícita y compatibilidad con llamadores anteriores.

Las comprobaciones en navegador usan el formulario real con un arnés temporal local; no escriben en Production. La captura local no demuestra que la corrección ya esté publicada.

## Resultado local

- 23 comprobaciones contra PostgreSQL aislado aprobadas; el guardado de un alumno también incluye el contenido compartido en la misma transacción.
- 1811/1811 pruebas existentes aprobadas en la corrida final.
- Compilación de producción aprobada con webpack, incluida la comprobación TypeScript. Advertencia preexistente de carga dinámica de `libheif-js`; sin error de compilación.
- Controles probados en navegador: agregar actividad, notas multilínea, tema visto y revisión de tarea que sigue visible después de seleccionar el resultado. Anchos 320, 390 y 1280 sin desborde horizontal medido en DOM. No se comprobó un dispositivo físico.
- El lector de una prueba estructural de fechas normaliza CRLF a LF para que las mismas comprobaciones funcionen en Windows; no se cambió el calendario ni su formateador.
- El arnés temporal de navegador fue retirado antes del build final. No se escribieron datos de producción, no se aplicó la migración remota y no se publicó esta corrección.
