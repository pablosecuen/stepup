# Rediseño visual de TeacherFlow Web — especificación v1

Estado: **dirección visual aprobada** por Joaquín tras revisar el prototipo completo (59 pantallas, 254 estados). La aprobación es sobre la dirección general; la ubicación exacta de cada botón, la jerarquía y las acciones se corrigen durante la implementación, bloque por bloque, con revisión visual al final de cada uno.

## Qué se aprobó (y debe conservarse)

| Decisión | Detalle |
|---|---|
| Base operativa y densa | Estructura de la dirección **B** (producto): barra lateral, tablas y paneles densos. |
| Tipografía y sobriedad | Dirección **A** (editorial): Fraunces para títulos, cifras y nombres; Hanken Grotesk para la interfaz; menú de cuenta con el nombre en serifa. |
| Calidez y alumnos | Dirección **C** (estudio): fondo de papel cálido (nunca gris corporativo), avatares de alumnos con tonos cálidos. |
| Identidad | **ink + ivory** (el logo de TeacherFlow). |
| Acento | **Terracota** `#B4461E`, único acento. |
| Navegación móvil | Propia, no el escritorio comprimido: barra superior + barra inferior de cinco destinos. |
| Calendario móvil | Agenda por día (no grilla de siete columnas). |
| Calendario, colores | La **escala congelada** de tarjetas no se toca (`lib/calendar-theme.ts`). |

## Qué NO se aprobó para implementar todavía

Todo lo marcado «Propuesta» en el prototipo (ver [04-propuestas-y-limites.md](04-propuestas-y-limites.md)): panel de notificaciones, detalle de cobro, acciones nuevas en recordatorios, confirmaciones o flujos que hoy no existen, información adicional en Inicio que requiera cambiar consultas o lógica. Cada una requiere una decisión de producto propia.

## Reglas permanentes del rediseño

1. Ningún bloque cambia lógica de negocio, Supabase, migraciones, autenticación ni datos: es presentación.
2. Se preserva toda la accesibilidad de B8 (salto al contenido, foco visible, roles y nombres accesibles, objetivos táctiles de 44 px, estado nunca sólo por color, contraste AA). Las pruebas de B8 se mantienen; si una cambia es sólo porque cambió un valor de color documentado aquí, nunca para relajar una regla.
3. Los textos funcionales no cambian sin justificación escrita.
4. No se copia código generado del prototipo: se adapta al código real (Next 16, Tailwind 3, componentes existentes).
5. Cada bloque se revisa visualmente (escritorio, 390 px y 320 px) antes de pasar al siguiente. No hay deploy hasta esa revisión.

## Documentos

| Archivo | Contenido |
|---|---|
| [01-fundamentos.md](01-fundamentos.md) | Colores y tokens, tipografías, espaciado, radios/bordes/sombras, foco y accesibilidad. |
| [02-componentes-y-navegacion.md](02-componentes-y-navegacion.md) | Componentes base, navegación (escritorio y móvil), menú de cuenta, comportamiento responsive. |
| [03-mapa-de-pantallas.md](03-mapa-de-pantallas.md) | Las 59 pantallas del prototipo, flujos, y la tabla ruta real ↔ pantalla del prototipo. |
| [04-propuestas-y-limites.md](04-propuestas-y-limites.md) | Propuestas no implementadas y lo que el prototipo no pudo representar. |
| [05-plan-de-bloques.md](05-plan-de-bloques.md) | Bloques de implementación y su estado. |
| [06-bloque-1.md](06-bloque-1.md) | Bloque 1 implementado: alcance, diferencias con el prototipo y verificación. |
| [07-bloque-2.md](07-bloque-2.md) | Bloque 2 (Inicio): estados, diferencias inevitables y verificación. |

## Dónde está el prototipo

Copia durable y autocontenida (fuera del repositorio, no se versiona por su tamaño: 94 MB con las 508 capturas):

```
C:\Users\joaqu\tf-design\prototipo-web-v1\
  dist\index.html      panel navegable (abrir en el navegador)
  src\                 fuentes del prototipo (JS vanilla + CSS)
  capturas\            508 capturas (escritorio y móvil) y hojas de contacto
  PROTOTIPO_WEB.md     el mismo mapa que 03-mapa-de-pantallas.md
```

El CSS del prototipo (`src/app.css`) es la **referencia visual** de cada componente; este documento fija los valores y las reglas. Si hay diferencia entre ambos, manda este documento.
