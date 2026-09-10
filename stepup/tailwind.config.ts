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
        xl: "20px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(8,8,8,0.04), 0 10px 24px -16px rgba(8,8,8,0.16)",
        cardHover: "0 2px 4px rgba(8,8,8,0.05), 0 18px 32px -14px rgba(8,8,8,0.18)",
        panel: "0 24px 60px -20px rgba(8,8,8,0.32)",
        subtle: "0 1px 2px rgba(8,8,8,0.05)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
