// Migrado desde .eslintrc.json ("extends": "next/core-web-vitals") — Next.js
// 16 elimina `next lint` y eslint-config-next pasa a flat config. Mismo
// alcance que antes (sólo core-web-vitals), sin sumar reglas nuevas.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// `lib/original-core` es la copia verbatim del dominio de la app original (referencia para pruebas, no se despliega): no se edita para contentar al linter.
const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "tools/phone-extraction/mobile-patch/**", "tools/legacy-readonly/mobile-patch/**", "lib/original-core/**"]),
]);

export default eslintConfig;
