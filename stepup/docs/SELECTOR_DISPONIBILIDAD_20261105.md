# Selector de disponibilidad y ayuda — 05/11/2026

Base: `624a19a`. Rama propia `availability-picker-20261105`, separada del trabajo de Claude sobre Series.

## Implementado

- Se extrajo `AvailabilityMonth`, compartiendo el selector real entre todos los formularios que usan `AvailabilityPicker`.
- Causa del encimado del video: la regla global mantiene cada botón en al menos 44 px, mientras siete columnas intentaban repartirse un contenedor más estrecho. La grilla ahora reserva 332 px (7 × 44 + 6 × 4), con desplazamiento horizontal contenido solo si su padre es demasiado estrecho. No se achican los objetivos táctiles ni se desborda la página.
- Se retiró el marco anidado del selector para aprovechar el ancho disponible. A 375, 390 y 430 px se ven las siete columnas en el contenedor normal; un padre de 250 px permite desplazarse dentro del calendario.
- Las referencias de colores, el significado de los números, los gestos de cuartos de hora y la explicación de disponibilidad están en Información → Elegir fecha y horario. El selector conserva solo «Ayuda de horarios», que abre otra pestaña para no descartar el formulario.
- Al cambiar de mes o de serie, no se muestran disponibilidades calculadas para la consulta anterior. Mientras se carga, se omiten los números de horarios libres y se anuncia la carga.
- No se cambiaron el cálculo de choques, la duración, los cuartos de hora, los gestos ni las acciones de guardado.

## Verificación

Componente real con datos sintéticos en navegador aislado, a 320, 375, 390, 430 y 1366 px, más el mismo calendario dentro de un padre de 250 px. Se midieron todos los rectángulos de los días: 0 colisiones, ancho mínimo de 44 px y sin desborde del documento. Clics reales para elegir fecha, cambiar de mes y elegir hora. Pruebas diferenciales de horarios contra el original conservadas.

Capturas y scripts de revisión en `output/review-20261105/`, fuera del repositorio. La ruta temporal de prueba se eliminó. No se usó la cuenta real ni se guardaron datos. No equivale a probar físicamente un iPhone.

## Detalle grupal: solo propuestas

Se prepararon tres propuestas interactivas para revisión: Lista compacta, Miembros desplegables y Avatares y nombres. No se modificó `real-lesson-detail-modal.tsx`. La elección del diseño sigue pendiente.

## Integración

Este bloque no modifica las tarjetas, páginas ni acciones de Series que tiene asignadas Claude. Publicar la integración conjunta después de revisar su commit; no publicar este bloque por separado.
