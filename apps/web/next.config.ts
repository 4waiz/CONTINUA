import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The scene packages ship TypeScript source, not a build artefact.
  transpilePackages: ['@continua/scene', '@continua/contracts'],
  // Workspace root, so tracing does not wander up past the monorepo.
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        // Runtime models are content-addressed by the build; cache them hard.
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
