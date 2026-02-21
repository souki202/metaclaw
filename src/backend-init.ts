/**
 * バックエンド初期化モジュール
 * Next.js の instrumentation.ts から呼び出され、SessionManager・Discord・Heartbeat を起動する
 */
import 'dotenv/config';
import { loadConfig } from './config.js';
import { SessionManager } from './core/sessions.js';
import { DiscordChannel } from './channels/discord.js';
import { logger } from './logger.js';
import type { DashboardEvent } from './types.js';
import { setGlobalState, broadcastSseEvent } from './global-state.js';

let started = false;

export async function initializeBackend() {
  if (started) return;
  started = true;

  logger.info('Initializing meta-claw backend...');

  let config;
  try {
    config = loadConfig();
  } catch (e: unknown) {
    logger.error('Failed to load config:', (e as Error).message);
    return;
  }

  const sessions = new SessionManager(config);

  // グローバルステートにセット（Next.js APIルートから参照される）
  setGlobalState(sessions, config);

  // エージェントイベント → SSEブロードキャスト
  const onEvent = (event: { type: string; sessionId: string; data: unknown }) => {
    broadcastSseEvent({
      type: event.type as DashboardEvent['type'],
      sessionId: event.sessionId,
      data: event.data,
      timestamp: new Date().toISOString(),
    });
  };

  // 全セッション起動
  sessions.startAll(onEvent);
  logger.info(`Started ${sessions.getSessionIds().length} session(s): ${sessions.getSessionIds().join(', ')}`);

  // Discord ボット起動
  const discordBots = new Map<string, DiscordChannel>();
  const activeTokens = new Set<string>();

  for (const s of Object.values(config.sessions)) {
    if (s.discord?.enabled && s.discord?.token) {
      activeTokens.add(s.discord.token);
    }
  }

  for (const token of activeTokens) {
    const d = new DiscordChannel(token, sessions);
    try {
      await d.start();
      discordBots.set(token, d);
      logger.info(`Discord bot started for token ending in ...${token.slice(-4)}`);
    } catch (e: unknown) {
      logger.error(`Discord bot failed for token ...${token.slice(-4)}: ${(e as Error).message}`);
    }
  }

  // Heartbeat 通知 → Discord または ログ
  sessions.setHeartbeatNotificationHandler(async ({ sessionId, message }) => {
    logger.info(`Heartbeat alert from "${sessionId}": ${message.slice(0, 100)}`);
    const sessionConfig = config.sessions[sessionId];
    if (sessionConfig?.discord?.token && sessionConfig?.discord?.channels?.length) {
      const token = sessionConfig.discord.token;
      const bot = discordBots.get(token);
      if (bot) {
        const channelId = sessionConfig.discord.channels[0];
        await bot.sendToChannel(channelId, `💓 **Heartbeat Alert** [${sessionId}]\n${message}`);
      }
    }
  });

  // グレースフルシャットダウン
  const shutdown = async (signal: string, code = 0) => {
    logger.info(`Received ${signal}. Shutting down...`);
    setTimeout(() => {
      logger.error('Shutdown timed out. Forcing exit.');
      process.exit(code);
    }, 3000);

    try {
      await sessions.stopAll();
      for (const bot of discordBots.values()) {
        await bot.stop().catch((e) => logger.error('Discord stop error:', e));
      }
    } catch (e: unknown) {
      logger.error('Shutdown error:', (e as Error).message);
    }
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('meta-claw-restart', () => shutdown('RESTART', 75));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
  });

  logger.info('meta-claw backend ready!');
}
