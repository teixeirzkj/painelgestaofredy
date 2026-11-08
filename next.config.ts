import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Quem pode abrir telas do sistema dentro de um quadro (iframe).
 * Só a venda rápida e o login (que ela usa) podem ficar embutidos no Frédy/WTS; a gestão não pode ser embutida em nenhum site
 * (evita clickjacking). FRAME_ANCESTORS_EXTRA permite incluir outro domínio (separado por espaço) sem mexer no código.
 */
const embedAncestors = ["'self'", "https://*.wts.chat", "https://*.flw.chat", ...(process.env.FRAME_ANCESTORS_EXTRA?.split(/\s+/).filter(Boolean) ?? [])].join(" ");

function csp(frameAncestors: string) {
  return [
    "default-src 'self'",
    // Next.js injeta scripts inline de hidratação; em desenvolvimento o React também precisa de eval
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      // padrão: nada pode embutir o sistema
      { source: "/:path*", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("'none'") }] },
      // venda rápida e login podem ficar dentro do Frédy/WTS (as regras posteriores sobrescrevem as anteriores)
      ...["/balcao", "/balcao/:path*", "/login"].map((source) => ({
        source,
        headers: [...common, { key: "X-Frame-Options", value: "" }, { key: "Content-Security-Policy", value: csp(embedAncestors) }],
      })),
    ];
  },
};

export default nextConfig;
