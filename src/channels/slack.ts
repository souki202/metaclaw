import { RTMClient } from '@slack/rtm-api';
import { WebClient } from '@slack/web-api';
import type { SessionManager } from '../core/sessions.js';
import { createLogger } from '../logger.js';

const log = createLogger('slack');

const MAX_MESSAGE_LENGTH = 3500;

export class SlackChannel {
  private rtm: RTMClient;
  private web: WebClient;
  private sessions: SessionManager;
  private botToken: string;
  private botUserId: string | null = null;

  constructor(botToken: string, sessions: SessionManager) {
    this.botToken = botToken;
    this.sessions = sessions;
    this.rtm = new RTMClient(botToken);
    this.web = new WebClient(botToken);

    this.setupHandlers();
  }

  private setupHandlers() {
    this.rtm.on('ready', () => {
      log.info('Slack RTM connected');
    });

    this.rtm.on('message', async (event: any) => {
      await this.handleMessage(event);
    });

    this.rtm.on('error', (error) => {
      log.error('Slack RTM error:', error);
    });
  }

  private async handleMessage(event: any) {
    if (!event || event.type !== 'message') return;
    if (event.bot_id) return;
    if (event.subtype && event.subtype !== 'file_share') return;

    const channelId = typeof event.channel === 'string' ? event.channel : undefined;
    const userId = typeof event.user === 'string' ? event.user : undefined;
    const teamId = typeof event.team === 'string' ? event.team : undefined;
    if (!channelId) return;

    const sessionId = this.sessions.resolveSlackSession(teamId, channelId, userId, this.botToken);
    if (!sessionId) {
      log.debug(`No session found for team=${teamId} channel=${channelId} user=${userId}`);
      return;
    }

    const sessionConfig = this.sessions.getSessionConfigs()[sessionId];
    const slackCfg = sessionConfig?.slack;

    if (slackCfg?.allowFrom && slackCfg.allowFrom.length > 0) {
      if (!userId || !slackCfg.allowFrom.includes(userId)) {
        log.debug(`User ${userId} not in allowlist for session ${sessionId}`);
        return;
      }
    }

    const isDirectMessage = channelId.startsWith('D');
    const text = typeof event.text === 'string' ? event.text : '';
    const isMentioned = !!(this.botUserId && text.includes(`<@${this.botUserId}>`));

    if (!isDirectMessage && !isMentioned) {
      if (!slackCfg?.channels?.includes(channelId)) return;
    }

    const agent = this.sessions.getAgent(sessionId);
    if (!agent) {
      log.warn(`Agent not found for session: ${sessionId}`);
      return;
    }

    let content = text;
    if (this.botUserId) {
      content = content.replaceAll(`<@${this.botUserId}>`, '').trim();
    }

    if (slackCfg?.prefix && content.startsWith(slackCfg.prefix)) {
      content = content.slice(slackCfg.prefix.length).trim();
    }

    if (!content) return;

    log.info(`Message from ${userId ?? 'unknown'} in ${channelId}: ${content.slice(0, 80)}`);

    try {
      const response = await agent.processMessage(content, channelId);
      const chunks = splitMessage(response, MAX_MESSAGE_LENGTH);
      const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : undefined;

      for (const chunk of chunks) {
        await this.web.chat.postMessage({
          channel: channelId,
          text: chunk,
          thread_ts: threadTs,
        });
      }
    } catch (err) {
      log.error('Error processing Slack message:', err);
      try {
        await this.web.chat.postMessage({
          channel: channelId,
          text: 'An error occurred while processing your message.',
        });
      } catch (postError) {
        log.error('Failed to send Slack error message:', postError);
      }
    }
  }

  async sendToChannel(channelId: string, message: string) {
    try {
      const chunks = splitMessage(message, MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await this.web.chat.postMessage({ channel: channelId, text: chunk });
      }
    } catch (e) {
      log.error(`Failed to send to Slack channel ${channelId}:`, e);
    }
  }

  async start() {
    await this.rtm.start();
    try {
      const auth = await this.web.auth.test();
      this.botUserId = (auth.user_id as string | undefined) ?? null;
      log.info(`Slack bot authenticated as user ${this.botUserId ?? 'unknown'}`);
    } catch (e) {
      log.warn('Slack auth.test failed, mention detection may be limited:', e);
    }
  }

  async stop() {
    try {
      await this.rtm.disconnect();
    } catch {
      // no-op
    }
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
