# TeacherFlow Web

Versión web/PWA de TeacherFlow (Next.js 15 + TypeScript + Tailwind).

## Estado (Fase A)

Base técnica y pantallas de vista previa, con datos ficticios. Todavía no
hay autenticación real ni conexión a Supabase — ver `.env.example` para las
variables que se completarán en una fase posterior.

## Desarrollo

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — servidor de desarrollo.
- `npm run build` — build de producción.
- `npm run start` — sirve el build de producción.
- `npm run lint` — ESLint.
- `npm run typecheck` — TypeScript sin emitir archivos.
