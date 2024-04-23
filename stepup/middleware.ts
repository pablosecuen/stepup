import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Rutas que pueden ser accedidas sin autenticación
  publicRoutes: ['/',"/checkout","/contacto","/tienda","/tracking", "/tienda/:modelo"],
  // Rutas que siempre pueden ser accedidas y no requieren información de autenticación
  ignoredRoutes: ["/tienda"],
});

export const config = {
  // Protege todas las rutas, incluidas las api/trpc.
  // Verifica https://clerk.com/docs/references/nextjs/auth-middleware
  // para más información sobre cómo configurar tu Middleware
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)"],
};
