import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * `CONTINUA_STATIC=1` produces a fully static export for the public deployment.
 *
 * The site has no server of its own: the CONTINUA engine is Python and runs
 * separately, so every page here is either static or client-rendered against
 * that engine over the network. That makes `output: 'export'` the honest build
 * - nothing is silently server-rendered at the edge - and it deploys to
 * Cloudflare as plain assets.
 *
 * The normal `npm run build` is unchanged, because the video capture pipeline
 * and the Playwright suites run against the server build.
 */
const isStaticExport = process.env.CONTINUA_STATIC === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The scene packages ship TypeScript source, not a build artefact.
  transpilePackages: ['@continua/scene', '@continua/contracts'],
  // Workspace root, so tracing does not wander up past the monorepo.
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  typescript: { ignoreBuildErrors: false },

  ...(isStaticExport
    ? {
        output: 'export' as const,
        // Static hosting serves `/path/index.html`, so emit directories.
        trailingSlash: true,
        // There is no image optimiser without a server.
        images: { unoptimized: true },
      }
    : {
        async headers() {
          return [
            {
              // Runtime models are content-addressed by the build; cache hard.
              source: '/models/:path*',
              headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
            },
          ];
        },
      }),
};

export default nextConfig;
