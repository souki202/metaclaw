import 'dotenv/config';
import path from 'path';
import { loadConfig } from './config.js';
import { SessionManager } from './core/sessions.js';
import { DashboardServer } from './dashboard/server.js';
import { DiscordChannel } from './channels/discord.js';
import { logger } from './logger.js';
import type { DashboardEvent } from './types.js';

async function main() {
  logger.info('Starting mini-claw...');

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

  // Heartbeat notifications → Discord or log
  let discord: DiscordChannel | null = null;
  sessions.setHeartbeatNotificationHandler(async ({ sessionId, message }) => {
    logger.info(`Heartbeat alert from "${sessionId}": ${message.slice(0, 100)}`);
    const sessionConfig = config.sessions[sessionId];
    if (discord && sessionConfig?.discord?.channels?.length) {
      const channelId = sessionConfig.discord.channels[0];
      await discord.sendToChannel(channelId, `💓 **Heartbeat Alert** [${sessionId}]\n${message}`);
    }
  });

  // Discord
  if (config.discord?.token) {
    discord = new DiscordChannel(config.discord.token, sessions);
    try {
      await discord.start();
      logger.info('Discord bot started.');
    } catch (e: unknown) {
      logger.error('Discord failed to start:', (e as Error).message);
    }
  } else {
    logger.info('Discord not configured (no discord.token in config).');
  }

  // Start dashboard
  if (dashboard) {
    await dashboard.start(config.dashboard.port);
  }

  logger.info('mini-claw ready!');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    sessions.stopAll();
    await discord?.stop();
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
