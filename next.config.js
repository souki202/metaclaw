/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Custom server is used for WebSocket support
  // This disables automatic code splitting for API routes
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize packages that should not be bundled
      config.externals.push('puppeteer');
    }
    return config;
  },
};

module.exports = nextConfig;
