import type { Config } from "tailwindcss";
const {nextui} = require("@nextui-org/react");
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/flowbite/**/*.js",
      "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      
      backgroundImage: {
        "salesbg": "url('../../public/assets/banner/salesbg.jpg')",
        "service": "url('../../public/assets/banner/service.png')",
      },
        fontFamily: {
          "newake": ['NewakeFont-Demo', 'sans'],
           "play": ['Play-Regular', 'sans'],
      },
      keyframes: {
      
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-100%)' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0%)', opacity: '1' },
        },
        slideOutRight: {
          '0%': { transform: 'translateX(0%)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0%)', opacity: '1' },
        },
        slideOutLeft: {
          '0%': { transform: 'translateX(0%)', opacity: '1' },
          '100%': { transform: 'translateX(-100%)', opacity: '0' },
        },
           backgroundShine: {
          'from': { backgroundPosition: '0 0' },
          'to': { backgroundPosition: '-200% 0' },
        },
      },
              animation: {
        carousel: 'marquee 240s linear infinite',
        fadeIn: 'fadeIn 0.9s ease-in-out',
        fadeOut: 'fadeOut 0.9s ease-in-out',
        slideInRight: 'slideInRight 0.5s ease-in-out',
        slideOutRight: 'slideOutRight 0.5s ease-in-out',
        slideInLeft: 'slideInLeft 0.5s ease-in-out',
        slideOutLeft: 'slideOutLeft 0.5s ease-in-out',
           backgroundShine: 'backgroundShine 2s linear infinite',
      }
    },
  },
  plugins: [ require('flowbite/plugin' ), nextui()],
};
export default config;
