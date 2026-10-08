import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the API test-suite run its own dev server next to yours (Next allows one dev server per build dir).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Dev only: lets the PDF renderer's browser (which opens http://127.0.0.1:...) load dev resources.
  allowedDevOrigins: ["127.0.0.1"],
  // The online store is the front door of the site; staff reach their sign-in from the store's "Sign in" menu.
  async redirects() {
    return [{ source: "/", destination: "/store", permanent: false }];
  },
};

export default nextConfig;
