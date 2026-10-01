import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the API test-suite run its own dev server next to yours (Next allows one dev server per build dir).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Dev only: lets the PDF renderer's browser (which opens http://127.0.0.1:...) load dev resources.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
