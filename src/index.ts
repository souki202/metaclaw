import 'dotenv/config';
import path from 'path';
import { loadConfig } from './config.js';
import { SessionManager } from './core/sessions.js';
import { DashboardServer } from './dashboard/server.js';
import { DiscordChannel } from './channels/discord.js';
import { logger } from './logger.js';
import type { DashboardEvent } from './types.js';

async function main() {
  logger.info('Starting meta-claw...');

  let config;
  try {
    config = loadConfig();
  } catch (e: unknown) {
    logger.error('Failed to load config:', (e as Error).message);
    process.exit(1);
  }

  const sessions = new SessionManager(config);

  // Dashboard setup
  let dashboard: DashboardServer | null = null;
  if (config.dashboard.enabled) {
    dashboard = new DashboardServer(sessions);
  }

  // Event relay: agent events → dashboard WebSocket
  const onEvent = (event: { type: string; sessionId: string; data: unknown }) => {
    dashboard?.broadcast({
      type: event.type as DashboardEvent['type'],
      sessionId: event.sessionId,
      data: event.data,
      timestamp: new Date().toISOString(),
    });
  };

  // Start all sessions
  sessions.startAll(onEvent);
  logger.info(`Started ${sessions.getSessionIds().length} session(s): ${sessions.getSessionIds().join(', ')}`);

  // Start dashboard
  if (dashboard) {
    await dashboard.start(config.dashboard.port);
  }

  // Heartbeat notifications → Discord or log
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
    } catch(e: unknown) {
      logger.error(`Discord bot failed for token ...${token.slice(-4)}: ${(e as Error).message}`);
    }
  }

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

  logger.info('meta-claw ready!');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    sessions.stopAll();
    for (const bot of discordBots.values()) {
      await bot.stop();
    }
    dashboard?.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
  });
}

main();
