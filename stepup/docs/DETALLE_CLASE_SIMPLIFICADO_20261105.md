# Detalle de clase simplificado — 05/11/2026

Panel compartido por Inicio → Agenda del día y Calendario.

- Acceso compacto «Ver alumno» a la ficha, sin repetir su nombre como botón.
- Acciones prioritarias: «Reprogramar» (solo esta clase), «Administrar miembros» y «Cancelar esta clase» con su confirmación.
- «Administrar serie» dentro de «Más opciones», cerrado por defecto y dirigido a la serie exacta.
- Se retiraron de este panel cambiar tipo, editar nombre, cambiar duración, volver a la fecha original y eliminar esta y las siguientes.
- Se mantienen registrar/editar el registro cuando corresponde al estado de la clase. Reemplazar un horario cancelado sigue como acción contextual dentro del desplegable.
- El panel de reprogramación recibe `singleClassOnly`: no muestra el selector de alcance y fuerza el alcance individual incluso si se modifican sus props. Administrar la serie conserva su circuito independiente.
- Sin migraciones ni modificaciones de clases, alumnos, registros, cobros o pagos reales.

Verificación visual con el componente real y datos sintéticos en un navegador aislado: 375, 390, 430 y 1366 px, sin desborde horizontal. Clics reales: abrir «Más opciones», enlace a la serie correcta, cancelar → confirmar → volver, reprogramar sin selector de serie. Capturas en `output/class-panel-20261105/` fuera del repositorio. Ruta temporal eliminada antes de compilar/publicar. No equivale a una prueba física en iPhone ni a guardar operaciones con una sesión de QA.
