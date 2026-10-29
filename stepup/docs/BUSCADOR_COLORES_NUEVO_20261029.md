# Buscador de Alumnos, colores de los gráficos, demanda y etiqueta «Nuevo» — 29/10/2026

Base: `afe530d` (lo publicado). Sin migraciones ni cambios de datos.

## 1 · Buscador de Alumnos
- **Circuito real**: el campo era un formulario GET que sólo buscaba al enviarlo («Aplicar filtros»). El servidor ya buscaba en toda la cuenta, pero (a) ordenaba alfabéticamente aunque hubiera texto, (b) el estado «Activo» venía puesto y dejaba fuera en silencio a pausados/inactivos, y (c) el motor toleraba errores de tipeo ya con 2 letras.
- **Búsqueda al escribir**: 200 ms tras la última tecla, `router.replace` (sin una entrada de historial por letra y sin la página: vuelve a la 1). Enter aplica al instante (`router.push`). El campo es controlado por el navegador: nunca se le pisa texto, cursor ni foco; la lista no se anima ni se reemplaza por un esqueleto.
- **Respuestas viejas**: la navegación del router descarta la anterior; el conteo sale de la misma respuesta que la lista. Verificado con una respuesta vieja que tarda 3,2 s contra la nueva en 150 ms.
- **Motor** (`lib/students/search.ts`, el mismo de Nueva clase y demás pantallas): 1–2 letras = sólo comienzo, fragmento literal o iniciales contiguas; prefijo aproximado desde 4 letras; subsecuencia desde 4; palabra exacta antes que comienzo; se usa la mejor de dos distancias. **Cambio de comportamiento compartido**: «je» ya no encuentra a «José» (antes por distancia), «jo» sí.
- **Orden**: exacto → palabra exacta → comienzo → fragmento → aproximada (por cercanía); a igual relevancia rige el orden elegido. Todo antes de paginar.
- **Filtros**: se conservan; aviso con ícono y texto («Se buscan coincidencias dentro de los filtros elegidos… Hay N más fuera de ellos») y «Quitar filtros» (conserva el texto).
- **Dirección**: `/alumnos?q=…&status=…` limpia y recargable; «Volver a Alumnos» desde un perfil recupera búsqueda, filtros y página de la pestaña.

## 2 · Colores de los gráficos financieros
Tokens nuevos `budgetNeeds #2563EB`, `budgetWants #9333EA`, `budgetSavings #008568` (sólo relleno/trazo/muestra). Mismos en dona, barra, leyenda, diálogo de ajuste, objetivo de ahorro, barras de «Proyección y ahorro» y la dona de la landing. Sin opacidad. «Real» = sólido; «Mes en curso» = sólido con borde grueso de tinta; «Estimado» = trama diagonal del color de la categoría con borde punteado; también en texto (leyenda, tabla, resumen accesible). Sin tocar «Evolución de cobros» ni los colores generales (`dataNeeds` y demás siguen).

## 3 · Demanda semanal y horaria
Causa: grilla de dos columnas con filas estiradas (`stretch`) junto a «Valor programado de tu hora» (una fila por nivel). Ahora son dos columnas independientes (izquierda: Valor de la hora → Resumen anual; derecha: Demanda → Alumnos del año) desde 1100 px y una sola columna en el mismo orden debajo. Cada tarjeta mide su contenido y la siguiente empieza a 20 px.

## 4 · Etiqueta «Nuevo»
Causa: se leía `is_new`, que nace en verdadero, que la importación también dejaba en verdadero y que nada apagaba. Regla única `lib/students/new-student.ts`: fecha de alta real (`dateJoined`), desde el día del alta hasta cumplirse 10 días hábiles posteriores (lunes a viernes, fecha civil de Argentina, sin feriados), sin fecha válida o con fecha futura no se marca, vence sola. La usan la lista, las tarjetas y la proyección. La ficha del alumno no mostraba esta etiqueta y no se agregó.

## Pendiente
Revisión en iPhone/Safari físico; verificación en Production con la sesión QA.
