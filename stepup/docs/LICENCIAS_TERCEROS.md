# Licencias de terceros con condiciones especiales

## libheif-js (LGPL-3.0) — vista previa de fotos HEIC

- Paquete: `libheif-js` 1.23.5 (npm, `wasm-bundle.js`), que empaqueta `libheif` y `libde265` compilados a WebAssembly. Licencia: **GNU LGPL v3.0** (texto en `node_modules/libheif-js/LICENSE`).
- Uso en TeacherFlow: sólo para MOSTRAR en el navegador las fotos adjuntas en formato HEIC de las clases (`lib/images/heic-decode.ts`). Se carga únicamente al abrir una foto HEIC. No se modifica el código de la biblioteca.
- Cumplimiento: la biblioteca viaja como fragmento de JavaScript separado y sin modificar (la persona o el equipo puede reemplazarla por otra versión de `libheif-js` cambiando la versión fijada en `package.json`); el código fuente de `libheif` está en https://github.com/strukturag/libheif y el del empaquetado en https://github.com/catdad-experiments/libheif-js.
- Aviso para el usuario final (a incluir en la política/«Acerca de» de la fase 5): «La vista previa de fotos HEIC usa libheif (LGPL-3.0).»
- Dependencia sólo de pruebas (NO se distribuye): `pillow-heif`/`Pillow` en un entorno temporal de Python para generar los archivos sintéticos de `lib/images/__tests__/fixtures/` con `tools/images/make-fixtures.py`.
