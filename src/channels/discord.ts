import { Client, GatewayIntentBits, Events, Message, TextChannel, ActivityType, BaseGuildTextChannel } from 'discord.js';
import type { SessionManager } from '../core/sessions.js';
import { createLogger } from '../logger.js';

const log = createLogger('discord');

const TYPING_INTERVAL = 5000;

export class DiscordChannel {
  private client: Client;
  private sessions: SessionManager;
  private token: string;

  constructor(token: string, sessions: SessionManager) {
    this.token = token;
    this.sessions = sessions;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupHandlers();
  }

  private setupHandlers() {
    this.client.on(Events.ClientReady, (client) => {
      log.info(`Discord bot logged in as: ${client.user.tag}`);
      client.user.setActivity('meta-claw', { type: ActivityType.Watching });
    });

    this.client.on(Events.MessageCreate, async (message) => {
      await this.handleMessage(message);
    });

    this.client.on(Events.Error, (err) => {
      log.error('Discord client error:', err);
    });
  }

  private async handleMessage(message: Message) {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(this.client.user!);

    // In guild channels, require mention unless channel is configured
    const guildId = message.guildId ?? undefined;
    const channelId = message.channelId;
    const userId = message.author.id;

    const sessionId = this.sessions.resolveDiscordSession(guildId, channelId, userId, this.token);
    if (!sessionId) {
      log.debug(`No session found for guild=${guildId} channel=${channelId} user=${userId}`);
      return;
    }

    const sessionConfig = this.sessions.getSessionConfigs()[sessionId];
    const discordCfg = sessionConfig?.discord;

    // Check allowlist
    if (discordCfg?.allowFrom && discordCfg.allowFrom.length > 0) {
      if (!discordCfg.allowFrom.includes(userId)) {
        log.debug(`User ${userId} not in allowlist for session ${sessionId}`);
        return;
      }
    }

    // In guild channels, require mention unless the channel is explicitly configured
    if (!isDM && !isMentioned) {
      if (!discordCfg?.channels?.includes(channelId)) return;
    }

    const agent = this.sessions.getAgent(sessionId);
    if (!agent) {
      log.warn(`Agent not found for session: ${sessionId}`);
      return;
    }

    // Clean message content (remove bot mention)
    let content = message.content;
    if (isMentioned && this.client.user) {
      content = content.replace(`<@${this.client.user.id}>`, '').trim();
      content = content.replace(`<@!${this.client.user.id}>`, '').trim();
    }

    // Extract image attachment URLs
    const imageUrls = message.attachments
      .filter(a => a.contentType?.startsWith('image/'))
      .map(a => a.url);

    // Skip if no text and no images
    if (!content && imageUrls.length === 0) return;
    // If only images, provide a default prompt
    if (!content && imageUrls.length > 0) content = 'この画像を確認してください。';

    log.info(`Message from ${message.author.tag} in ${isDM ? 'DM' : `#${(message.channel as TextChannel).name}`}: ${content.slice(0, 80)}${imageUrls.length > 0 ? ` [${imageUrls.length} images]` : ''}`);

    // Show typing indicator (only for channels that support it)
    const typable = message.channel instanceof BaseGuildTextChannel || message.channel.isDMBased();
    const sendTyping = () => { if (typable && 'sendTyping' in message.channel) (message.channel as TextChannel).sendTyping().catch(() => {}); };
    const typingTimer = setInterval(sendTyping, TYPING_INTERVAL);
    sendTyping();

    try {
      const response = await agent.processMessage(content, channelId, imageUrls.length > 0 ? imageUrls : undefined);
      clearInterval(typingTimer);

      // Split long responses (Discord 2000 char limit)
      const chunks = splitMessage(response, 1900);
      for (const chunk of chunks) {
        await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
      }
    } catch (err) {
      clearInterval(typingTimer);
      log.error('Error processing message:', err);
      await message.reply('An error occurred while processing your message.');
    }
  }

  async sendToChannel(channelId: string, message: string) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        const chunks = splitMessage(message, 1900);
        for (const chunk of chunks) {
          await (channel as TextChannel).send(chunk);
        }
      }
    } catch (e) {
      log.error(`Failed to send to channel ${channelId}:`, e);
    }
  }

  async start() {
    await this.client.login(this.token);
  }

  async stop() {
    await this.client.destroy();
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
