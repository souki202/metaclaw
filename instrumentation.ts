import { initializeBackend } from './src/backend-init';

let initialized = false;

export async function register() {
  // ビルド時は実行しない
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // Node.js ランタイムのみ（edge runtimeでは動かない）
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // 二重初期化を防ぐ
  if (initialized) return;
  initialized = true;

  try {
    await initializeBackend();
  } catch (err) {
    console.error('[instrumentation] Backend initialization failed:', err);
  }
}
