// @ts-check

/**
 * Next.js 16 config — Turbopack is the default bundler.
 * If browser builds fail with "Module not found: fs/http/etc" from 3rd-party libs,
 * migrate to `turbopack.resolveAlias` with an empty stub
 * (see docs: 01-app/02-guides/upgrading/version-16.md — "Resolve alias fallback").
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {};

export default nextConfig;
