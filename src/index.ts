/**
 * スタンドアロン起動用エントリポイント（開発・デバッグ用）
 * 通常は Next.js の instrumentation.ts 経由でバックエンドが起動するため、
 * npm run dev / npm run start では直接このファイルは使用されない。
 */
import { initializeBackend } from './backend-init.js';

initializeBackend().catch((err) => {
  console.error('Failed to initialize backend:', err);
  process.exit(1);
});
