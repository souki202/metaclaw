let initialized = false;

export async function register() {
  // ビルド時は実行しない
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (initialized) return;
    initialized = true;

    // バックエンドの初期化を非同期で実行（Next.js の起動をブロックしない）
    import('./src/backend-init').then(mod => {
      return mod.initializeBackend();
    }).catch(err => {
      console.error('[instrumentation] Backend initialization failed:', err);
    });
  }
}
