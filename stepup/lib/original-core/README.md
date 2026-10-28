# Núcleo de dominio de la app original (puerto verbatim)

Copia **sin cambios de lógica** de las reglas puras del original (`src/features/*/utils`, servicios y almacenes con sus tipos), generada por el script `port-core.mjs` de la sesión de auditoría. Sólo se adaptan los imports (extensión `.ts` y `type`), el arnés de pruebas (`testHarness` → `node:test`) y dos reemplazos de plataforma en `shims/` (almacenamiento en memoria y `react` sin hooks ejecutables).

**Para qué sirve:**
1. Las **pruebas originales** (131 archivos, 2864 pruebas) corren contra este núcleo: eso prueba que las reglas portadas son las del original.
2. La web usa estas funciones (con adaptadores de base de datos) para las capacidades que faltaban: semáforo y estado del período de cobro, planes de cobro, cambio de monto mensual, generación de cargos semanales/quincenales, etc. Así el comportamiento no se reescribe: se reutiliza.
3. Sirve de referencia para comparar (prueba diferencial) las versiones propias de la web.

**No se edita a mano.** Las pruebas que leen el código de pantallas nativas (`fs.readFileSync` sobre `.tsx`) no se portan (no existen en la web); su equivalente son las pruebas de cableado de la web.
