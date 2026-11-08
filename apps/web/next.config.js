/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@omnirouter/canonical',
    '@omnirouter/providers',
    '@omnirouter/router-core',
    '@omnirouter/tools',
    '@omnirouter/crypto',
    '@omnirouter/db',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;

