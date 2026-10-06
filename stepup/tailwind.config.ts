import type { Config } from "tailwindcss";

// Paleta de TeacherFlow móvil (src/theme/colors.ts), con los textos, la marca y los estados oscurecidos lo justo para
// cumplir contraste AA en la web (texto 4.5:1 sobre blanco y sobre el fondo, también sobre sus tintes del 10%; blanco
// sobre el azul de marca 5.6:1). El móvil no se toca; los colores del calendario (escala congelada) tampoco.
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
        // Borde de controles de formulario (campos, selectores): 3:1 sobre blanco (WCAG 1.4.11). El borde claro de arriba
        // queda para tarjetas y separadores, que no necesitan contraste propio.
        borderStrong: "#8A8F97",
        textPrimary: "#080808",
        textSecondary: "#5D6168",
        textMuted: "#6B7078",
        brandBlue: "#0A64D2",
        brandBlueDark: "#004BA8",
        statusVerde: "#1B7634",
        statusAmarillo: "#7F5F00",
        statusNaranja: "#AA5208",
        statusRojo: "#BF2A20",
        statusPendiente: "#4361B8",
        statusSinDatos: "#6B7078",
        ink: "#080808",
        ivory: "#F2EEDF",
        // Exclusivos del plan 50/30/20 (Fase 8, `Resumen financiero`/
        // `budgetDistributionStore.ts` móvil) — nunca reutilizar para otra
        // pantalla (regla congelada, ver CLAUDE.md del repo móvil).
        pastelLavender: "#E9E2FF",
        pastelLavenderText: "#5A4780",
        pastelSage: "#DDEDDC",
        pastelSageText: "#35613B",
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
