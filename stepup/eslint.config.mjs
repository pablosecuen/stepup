// Migrado desde .eslintrc.json ("extends": "next/core-web-vitals") — Next.js
// 16 elimina `next lint` y eslint-config-next pasa a flat config. Mismo
// alcance que antes (sólo core-web-vitals), sin sumar reglas nuevas.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
