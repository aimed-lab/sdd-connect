import type { NextConfig } from "next";

// Report-only: browsers log violations to the console but block nothing. It has
// no report-uri yet, so it is deliberately permissive (Next needs inline
// scripts and styles; Google Fonts, Vercel Analytics / Speed Insights, Supabase
// and remote images must keep working). Tighten it, and enforce it, once a
// report endpoint shows what real pages load.
const isDev = process.env.NODE_ENV !== "production";
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com${isDev ? " ws:" : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self' https:",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  // Enforced: only this site may frame its pages (clickjacking). Nothing here
  // embeds the site elsewhere. X-Frame-Options covers older browsers.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: "/sign-in",
        destination: "/login",
        permanent: true,
      },
      // The industry page was removed; keep any shared old link working.
      {
        source: "/industry",
        destination: "/",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
