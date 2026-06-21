import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["sequelize", "pg", "pg-hstore"],
};

export default nextConfig;
