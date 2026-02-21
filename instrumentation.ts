let initialized = false;

export async function register() {
  // ビルド時は実行しない
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const mod = await import('./src/backend-init');
      await mod.initializeBackend();
    } catch (err) {
      console.error('[instrumentation] Backend initialization failed:', err);
    }
  }
}
