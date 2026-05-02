import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin'
import { withSentryConfig } from '@sentry/nextjs'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.join(appDir, '../..')
const nextDistDir = process.env.NEXT_DIST_MODE === 'build' ? '.next-build' : '.next'
const internalApiBaseUrl = process.env.INTERNAL_API_BASE_URL || process.env.RUNTIME_API_BASE_URL || 'http://localhost:3001'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep dev and production build artifacts isolated so local builds do not
  // corrupt a running `next dev` process in the same workspace.
  distDir: nextDistDir,
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ['@repo/shared'],
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/vnc/:path*',
        destination: `${internalApiBaseUrl.replace(/\/$/, '')}/api/v1/vnc/:path*`,
      },
    ]
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...config.plugins, new PrismaPlugin()]
    }
    return config
  },
}

if (process.env.NODE_ENV === 'production') {
  nextConfig.compiler = {
    // remove console.* calls
    removeConsole: {
      exclude: ['error', 'warn'], // keep console.error and console.warn
    },
  }
}

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'none',
  project: 'issue',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
})
