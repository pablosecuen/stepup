# Movimientos aprobados, 29/10/2026

Base integrada: `8f12757`. Se conserva el bloque de tarea con texto y fecha opcional, sin selector de clase futura.

- Bienvenida después de acceso correcto: mezcla marrón/crema, logo y «Tu lugar para crecer», 1600 ms como máximo. No cambia el formulario ni la autenticación. El destino normal sigue siendo Inicio; los enlaces privados explícitos conservan su destino seguro. Un marcador HttpOnly de 30 segundos se consume en el servidor; no se leen cookies desde el navegador. Movimiento reducido: 180 ms. Escape y Continuar permiten omitirla.
- Finanzas: barras y segmentos de las donas entran al aparecer en pantalla. Los importes, colores, etiquetas, porcentajes y cálculos son los existentes. No hay espera artificial para entregar datos.
- Alumnos: transición del nombre desde la lista a la ficha y regreso por el enlace, con limpieza al interrumpir la navegación. Registro usa la misma transición al abrir correctamente una clase. Los enlaces y el historial siguen siendo nativos.
- Cobros: ficha contextual en `/cobros/alumnos/[id]`; conserva Cobros activo, sus siete pestañas y «Volver a Cobros». Reutiliza los componentes y controles existentes, con consultas limitadas a la cuenta autenticada.
- Registro: insignia roja con el número real de pendientes en las tres presentaciones de navegación y junto al título de la lista. Una consulta compartida, sin sondeo periódico, usa la misma proyección y ventana de 90 días de Registro. Un error oculta el contador en vez de inventar un cero.

Verificación previa a publicación: suite completa 5204/5204. Tipos y lint sin errores. Bienvenida y gráfico real comprobados en laboratorio local con datos sintéticos, escritorio y 390 px; el laboratorio se eliminó antes de compilar. La bienvenida se cerró sola y devolvió el foco al contenido. Captura móvil en `qa-movimientos-20261029/bienvenida-390.png`.

La verificación en producción se completa después de publicar. No se cierra la sesión de QA para forzar la bienvenida. iPhone y Safari físicos no comprobados. No se declara paridad total de la aplicación.
