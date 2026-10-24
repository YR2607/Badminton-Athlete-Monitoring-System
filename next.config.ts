import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep visited pages in the client router cache so switching tabs /
  // going back doesn't hit the server again for a short window.
  experimental: {
    staleTimes: { dynamic: 30 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
