import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Workspace packages (packages/*) are written for Node's NodeNext
    // resolution, which requires relative imports to use an explicit `.js`
    // extension even though the source file is `.ts`/`.tsx`. Webpack's
    // default resolver looks for that exact `.js` file and fails, so this
    // teaches it to fall back to the TypeScript source.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
