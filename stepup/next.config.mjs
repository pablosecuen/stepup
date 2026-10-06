import { buildSecurityHeaders } from "./lib/security/security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No anunciar el framework en cada respuesta (`X-Powered-By: Next.js`).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
