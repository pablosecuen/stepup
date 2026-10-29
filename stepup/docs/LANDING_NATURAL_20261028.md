# Landing completa con la estética natural — 28/10/2026

Rama `landing-natural-20261028`, partida del commit `c72768c`. Carpeta de trabajo: `C:\Users\joaqu\tf-web-landnat`. **No publicada**: Codex integra este bloque con el suyo (aplicación privada y tokens globales) y hace la verificación final antes de publicar los dos juntos.

## Alcance respetado

Sólo se tocaron `app/page.tsx`, `components/landing/*`, la prueba `lib/ui/__tests__/landing-natural.test.ts` y este documento. No se editó `globals.css`, `layout.tsx`, `tailwind.config.ts`, ningún componente de UI, navegación, finanzas ni alumnos, ni lógica de negocio. La copia de Codex (`TeacherFlow_design_natural_20261028`) no se abrió para escribir.

## Qué quedó hecho (punto por punto del encargo)

1. **Archivos propios**: `app/page.tsx`, `components/landing/*` y un CSS nuevo, `components/landing/landing-natural.css`, importado desde `app/page.tsx`. **Todos** sus selectores están dentro de `.tf-landing` (lo verifica una prueba).
2. **Contenido conservado**: Hero, ProductIndex, SceneAgenda, SceneStudents, SceneCollections, TourSection, CalendarDetail, StudentsDetail, FinanceDetail, HowItWorks, Security, Closing y el pie; anclas, las cinco pantallas del recorrido, los paneles flotantes y sus interacciones, y el calendario real de las demostraciones. Comparación contra `c72768c`: de **755 textos** de los archivos de la landing, **0** se perdieron (las 7 diferencias son sólo clases de estilo reemplazadas). No reaparecen «Comenzar clase», «Ajustar horario», «Visto/Planificado» ni prefijos «Ocultar» (prueba).
3. **Estética aprobada en TODA la landing, incluidas pantallas y flotantes**: crema `#EAE6E1`, superficie `#FCFAF6`, beige `#E5E0DA`, lavanda `#C2BFCB`, lavanda suave `#E8E4EF`, oliva `#7E7B46`, marrón `#583B1F`. Títulos DM Serif Display (400 real, sin negrita sintética) e interfaz DM Sans. Mapa de uso: crema/superficie para lectura; lavanda suave como fondo de escena (Cobros-resumen, Calendario, Cómo funciona), paneles y píldoras; lavanda como borde/relleno de avatares y flotantes; oliva sólo como gráfico (marcas de las etiquetas, tildes) y su versión oscura `#5F5C2E` para el texto de las etiquetas y del índice. Los tokens y las fuentes globales los integra Codex: acá se reasignan **dentro de la landing** los mismos valores (la tipografía se declara con `next/font` sólo en esta página; al integrar queda redundante e inocua).
4. **Secciones diferenciadas**: claras (Producto, Recorrido, Cobros), crema (Agenda, Alumnos), lavanda suave (Cobros-resumen, Calendario, Cómo funciona), beige (Seguridad) y marrón (Alumnos-resumen, Cierre, recuadro del recorrido). Se conservan la disposición, la entrada y el paralaje. Botones del tamaño de su texto (sin estirarse), objetivos de 44 px y texto de controles de 16 px en móvil (clase `tf-ctl`). En escenas marrón el botón principal se invierte a lavanda suave con texto marrón.
5. **Franja de anuncio**: `components/landing/announcement-bar.tsx` + CSS. UNA sola, de borde a borde (fuera de `max-width`, sin márgenes ni esquinas redondeadas), `#EFB83F` con texto `#39250E`, 34 px en escritorio y 30 px en móvil, «15 % OFF al pagar el año completo», repetida y desplazándose sin saltos **hacia la izquierda** con CSS puro (dos grupos idénticos, recorrido de −50 %). Pausa al pasar el mouse y al enfocar; con «reducir movimiento» queda un solo mensaje quieto. Copias repetidas ocultas a lectores (`aria-hidden`) y sin tabulación (una sola parada de Tab). El enlace lleva a **/crear-cuenta** (el flujo real). **Cobro del plan anual: NO está configurado** (facturación apagada); la franja no simula ninguna compra ni checkout y no debe presentarse como que el año completo ya puede contratarse hasta que exista ese flujo.
6. **Insignias de notificación rojas** (`bg-bad`, blanco sobre `#962A20` = 7,9:1) en «Clases por registrar» y en el panel «Recordatorio», con el dato siempre en texto. Nombres largos compactos (una línea con puntos suspensivos; verificado con un nombre de 60 caracteres en 48 lugares a 390 px, sin ensanchar tarjetas ni desbordar). En móvil el importe de la dona 50/30/20 pasa fuera del centro (debajo del aro). Semáforos, escala del calendario y datos sin tocar (prueba).

## Tres reels

Dirección aplicada sin efectos gratuitos: sistema visual coherente (una sola paleta y tipografía en toda la landing); estructura estable (tarjetas que no cambian de alto, nombres que no ensanchan filas, aro con el importe afuera en móvil, sin saltos de diseño al cargar fuentes); jerarquía clara (títulos serif, etiquetas con marca, fondos alternados). No se agregaron demoras artificiales, animaciones eternas en el contenido (la única animación infinita es la franja, pedida), secuestro de scroll ni librerías. El esqueleto del recorrido (`Pending` en `tour.tsx`) ya conserva el alto de la pantalla. **No se pudo ver ni escuchar los reels** (Instagram no se abre sin sesión): se usó la dirección escrita en el encargo. No se afirma haber escuchado el audio.

## Verificación realizada (todo real, sobre esta rama)

- `tsc --noEmit`: sin errores. `eslint .`: sin errores. `next build --webpack`: compila (el `build` por defecto no corre con `node_modules` enlazado).
- Suite completa en copia LF: **5125 / 5125** (incluye las 15 pruebas nuevas de `landing-natural.test.ts` y las existentes de landing, copy, B8 y prefetch).
- Contraste WCAG medido en 23 combinaciones de texto (todas ≥ 4,5:1) y oliva gráfico ≥ 3:1; la lavanda `#C2BFCB` no lleva texto secundario (no llega a 4,5:1) y se usa sólo como relleno/borde.
- Navegador (Edge headless por CDP, sin sesión; la landing es pública): capturas por sección y de página completa a **375, 390, 430, 1366 y 1440 px**, sin desborde horizontal en ningún ancho, sin objetivos < 44 px (salvo la franja, ver abajo), controles de 16 px en móvil, sin palabras partidas a la mitad.
- Franja medida en movimiento real: desplazamiento hacia la izquierda (≈ 40 px/s), ancho = ancho de la ventana, alto 34 px / 30 px, radio 0, una sola parada de Tab, pausa al enfocar y al pasar el mouse (y reanuda), con movimiento reducido queda quieta.
- Recorrido con teclado: flechas, Inicio y Fin; foco visible en toda la cabecera, la franja y el recorrido.

## Excepciones y decisiones a revisar

- **Franja de 34 / 30 px**: el encargo fija ese alto y es incompatible con los 44 px que el proyecto exige a los enlaces. El enlace cubre todo el ancho de cada mensaje pero mide 34/30 px de alto. Es la única excepción deliberada (documentada en el componente).
- **Texto del CTA de la franja**: «Creá tu cuenta» (la franja es una invitación al flujo real, no una compra).
- **Verde «Necesidades»** de la dona: se dejó el azul de datos de la aplicación (`dataNeeds`) como en la vista previa aprobada; Codex lo cambió a marrón en sus tokens globales — al integrar, la dona seguirá a esos tokens.

## Pendiente (no se declara hecho)

- Revisión en un **iPhone/Safari físico** (la franja, las fuentes y el recorrido); sólo se verificó con Edge. Chrome/Firefox no se probaron.
- **Verificación en Production** y con la integración de Codex: la prueba cruzada de los dos bloques juntos la hace Codex antes de la publicación conjunta.
- Los 3 reels (ver arriba).
