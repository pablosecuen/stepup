import type { Config } from "tailwindcss";

// Paleta copiada de TeacherFlow móvil (src/theme/colors.ts) — no se modifica
// el original, sólo se reutilizan los mismos valores hexadecimales para que
// la web mantenga la identidad visual actual.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#FAFAF8",
        surface: "#FFFFFF",
        border: "#E3E5E8",
        textPrimary: "#080808",
        textSecondary: "#5D6168",
        textMuted: "#9499A1",
        brandBlue: "#168CF4",
        brandBlueDark: "#0060DF",
        statusVerde: "#2FB350",
        statusAmarillo: "#E8B400",
        statusNaranja: "#F07C1D",
        statusRojo: "#E0362B",
        statusPendiente: "#4361B8",
        statusSinDatos: "#9499A1",
        ink: "#080808",
        ivory: "#F2EEDF",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        pill: "999px",
      },
    },
  },
  plugins: [],
};
export default config;
