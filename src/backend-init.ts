/**
 * バックエンド初期化モジュール
 * Next.js の instrumentation.ts から呼び出され、SessionManager・Discord を起動する
 * 再起動時は process.exit() を呼ばず、インプロセスで再初期化する
 */
import 'dotenv/config';
import { loadConfig } from './config.js';
import { SessionManager } from './core/sessions.js';
import { DiscordChannel } from './channels/discord.js';
import { SlackChannel } from './channels/slack.js';
import { logger } from './logger.js';
import type { DashboardEvent } from './types.js';
import { setGlobalState, broadcastSseEvent } from './global-state.js';

let started = false;
let currentSessions: SessionManager | null = null;
let currentDiscordBots: Map<string, DiscordChannel> = new Map();
let currentSlackBots: Map<string, SlackChannel> = new Map();
let signalHandlersRegistered = false;

/**
 * バックエンドの停止（セッション + Discord）
 * process.exit() は呼ばない
 */
async function stopBackend() {
  logger.info('Stopping backend services...');
  try {
    if (currentSessions) {
      await currentSessions.stopAll();
    }
    for (const bot of currentDiscordBots.values()) {
      await bot.stop().catch((e) => logger.error('Discord stop error:', e));
    }
    for (const bot of currentSlackBots.values()) {
      await bot.stop().catch((e) => logger.error('Slack stop error:', e));
    }
  } catch (e: unknown) {
    logger.error('Stop error:', (e as Error).message);
  }
  currentSessions = null;
  currentDiscordBots.clear();
  currentSlackBots.clear();
}

export async function initializeBackend() {
  // 再起動の場合、先に既存のものを停止
  if (started) {
    await stopBackend();
  }
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
  currentSessions = sessions;

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
  currentDiscordBots = discordBots;
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

  // Slack ボット起動
  const slackBots = new Map<string, SlackChannel>();
  currentSlackBots = slackBots;
  const activeSlackTokens = new Set<string>();

  for (const s of Object.values(config.sessions)) {
    if (s.slack?.enabled && s.slack?.botToken) {
      activeSlackTokens.add(s.slack.botToken);
    }
  }

  for (const token of activeSlackTokens) {
    const slack = new SlackChannel(token, sessions);
    try {
      await slack.start();
      slackBots.set(token, slack);
      logger.info(`Slack bot started for token ending in ...${token.slice(-4)}`);
    } catch (e: unknown) {
      logger.error(`Slack bot failed for token ...${token.slice(-4)}: ${(e as Error).message}`);
    }
  }

  // スケジュールが変化したとき（CRUD・発火後の nextRunAt 更新）に SSE で通知する
  sessions.setScheduleChangeHandler((sessionId, schedules) => {
    broadcastSseEvent({
      type: 'schedule_update',
      sessionId,
      data: schedules,
      timestamp: new Date().toISOString(),
    });
  });

  // スケジュールハンドラーを登録してからスケジューラーを起動する
  // (起動順を保証することで、スケジューラーが最初のtickを実行する前にハンドラーが確実に設定される)
  sessions.setScheduleTriggerHandler(async ({ sessionId, schedule }) => {
    const wasActive = sessions.isSessionActive(sessionId);

    if (!wasActive) {
      // セッションが非アクティブな場合、スケジュール実行のために一時的に起動する
      const sessionConfig = sessions.getSessionConfig(sessionId);
      if (!sessionConfig) {
        logger.warn(`Schedule ${schedule.id} triggered for session "${sessionId}" which has no config. Skipping.`);
        return;
      }
      logger.info(`Session "${sessionId}" is not active. Starting temporarily for schedule ${schedule.id}.`);
      sessions.startSession(sessionId, sessionConfig, onEvent);
    }

    const agent = sessions.getAgent(sessionId);
    if (!agent) return;

    while (agent.isProcessing()) {
      logger.info(`Session "${sessionId}" is busy. Waiting before running schedule ${schedule.id}.`);
      await agent.waitForIdle();
    }

    const schedulePrompt = [
      '[SCHEDULE_TRIGGER] Registered schedule reached its time.',
      `Schedule ID: ${schedule.id}`,
      `Start At: ${schedule.startAt}`,
      `Repeat: ${schedule.repeatCron ?? 'none'}`,
      `Memo: ${schedule.memo}`,
      '',
      'Please execute this scheduled task now and continue as needed.',
    ].join('\n');

    logger.info(`Running schedule ${schedule.id} for session "${sessionId}"`);
    await agent.processMessage(schedulePrompt, 'schedule');

    if (!wasActive) {
      // 一時起動したセッションはタスク完了後に停止する
      while (agent.isProcessing()) {
        await agent.waitForIdle();
      }
      logger.info(`Schedule ${schedule.id} completed. Stopping temporary session "${sessionId}".`);
      sessions.stopSession(sessionId);
    }
  });

  // ハンドラー登録後にスケジューラーを起動する
  sessions.startScheduler();

  // プロセスシグナルハンドラは一度だけ登録する（再登録するとリーク）
  if (!signalHandlersRegistered) {
    signalHandlersRegistered = true;

    // グレースフルシャットダウン（SIGINT/SIGTERM → プロセス終了）
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down...`);
      setTimeout(() => {
        logger.error('Shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 3000);

      await stopBackend();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // AI再起動リクエスト → process.exit() せず、インプロセスで再初期化
    process.on('meta-claw-restart', () => {
      logger.info('Received RESTART. Reinitializing backend in-process...');
      initializeBackend().catch((err) => {
        logger.error('Failed to reinitialize backend:', err);
      });
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
    });
  }

  logger.info('meta-claw backend ready!');
}
