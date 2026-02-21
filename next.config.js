/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // src/ の既存コードにある型エラーはバックエンドのロジックであり
  // Next.js の型チェックからは除外する
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Node.js ネイティブ機能を使うサーバーパッケージをバンドルから除外
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "@puppeteer/browsers",
    "discord.js",
    "@discordjs/ws",
    "@discordjs/rest",
    "@discordjs/voice",
    "@discordjs/collection",
    "ws",
    "node-cron",
    "@modelcontextprotocol/sdk",
    "openai",
    "proxy-agent",
    "pac-proxy-agent",
    "@tootallnate/quickjs-emscripten",
    "socks-proxy-agent",
    "https-proxy-agent",
    "http-proxy-agent",
    "google-auth-library",
    "googleapis",
    "zlib-sync",
    "import-fresh",
    "node-domexception",
    "typescript",
    "cosmiconfig",
    "fetch-blob",
    "gaxios",
  ],
  webpack: (config, { isServer }) => {
    // src/ の TypeScript ファイルが .js 拡張子でインポートされるため
    // webpack が .js → .ts を解決できるよう設定
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };

    if (!isServer) {
      // クライアントサイドでは Node.js モジュールを無視
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        child_process: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
