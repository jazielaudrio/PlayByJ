import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Required for static export if you use the <Image> component
  images: {
    unoptimized: true,
  },
};

export default nextConfig;