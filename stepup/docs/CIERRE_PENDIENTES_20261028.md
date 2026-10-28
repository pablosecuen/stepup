# Cierre funcional en curso — 28/10/2026

Este bloque continúa la integración de 1226c1e. No declara paridad total: funcionamiento sin conexión y comprobación física siguen abiertos.

## Implementado

- Inicio: resumen mensual con prevista, cobrado, pendiente y vencido. Usa el mismo cálculo del Resumen financiero, con lecturas paralelas y sin escrituras durante GET.
- Navegación: preferencia del dispositivo Barra inferior / Menú del logo, con los mismos destinos y estética web. Escritorio conserva su barra lateral. El calendario hereda la altura disponible sin reservar una barra inexistente.
- Comenzar clase: un toque inicia el contador con llegada desconocida. No pregunta ni deduce la puntualidad al iniciar; conserva asistencia y corrección de sesión posterior.
- Eliminar alumno: previsualización versionada, nombre escrito y aceptación explícita. Operación atómica, idempotente y aislada por cuenta; retira al alumno de grupos y conserva compañeros, clases y registros compartidos. Borra sus hechos financieros sólo tras la confirmación de eliminación definitiva. Los archivos exclusivos se encolan y se borran cuando ninguna fila ni material los referencia. La cola reintenta en visitas posteriores y al recuperar conexión. Una operación vieja de alta no puede recrear al alumno eliminado.
- Consistencia: planificadores originales para duplicados técnicos, importe mensual vigente, cargos posteriores a la baja, cobertura mensual individual y vencimiento inicial demostrado. Entrenamiento siempre conserva acuerdo independiente. Aplicación atómica con versión de los hechos financieros y auditoría; no mueve pagos ni anula cargos con asignaciones. Correcciones seguras al generar cargos vigentes y antes de pagos; revisión y aplicación explícita desde Configuración.

## Corrección del inventario

INI-15 estaba mal clasificado: la pantalla Configuración del original no permite crear/eliminar ejemplos. `studentStore.ts` inicia vacío y conserva `LEGACY_DEMO_STUDENTS` sólo para reconocer y limpiar instalaciones anteriores. No se agrega una pantalla ficticia de ejemplos.

## Validación previa

- 5110/5110 pruebas; tipos, lint y build webpack limpios.
- PostgreSQL real aislado: eliminación con pagos y grupo compartido, confirmación y versión, aislamiento, reintento y fallo de borrado con reversión de pagos/participantes.
- PostgreSQL real aislado: reparación con auditoría, error intermedio y reversión, versión obsoleta, cuenta ajena/anon y pagos saldados intactos.
- Migraciones 20261031130000 y 20261031140000 aplicadas antes de publicar. Instalar las funciones no ejecuta eliminaciones ni reparaciones.

## Verificación de pantalla

Pendiente de la publicación de este bloque. No se da por comprobada por las pruebas de código.
