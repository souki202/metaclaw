import cron from 'node-cron';
import type { Agent } from './agent.js';
import { createLogger } from '../logger.js';

const log = createLogger('heartbeat');

function intervalToCron(interval: string): string {
  const match = interval.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match) return '*/30 * * * *'; // default 30 min

  const hours = parseInt(match[1] ?? '0');
  const minutes = parseInt(match[2] ?? '0');

  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes <= 0) return '*/30 * * * *';

  if (totalMinutes < 60) {
    return `*/${totalMinutes} * * * *`;
  }
  if (totalMinutes % 60 === 0) {
    return `0 */${totalMinutes / 60} * * *`;
  }
  // For irregular intervals, approximate with minute-level cron
  return `*/${Math.max(1, totalMinutes)} * * * *`;
}

export interface HeartbeatNotification {
  sessionId: string;
  message: string;
  timestamp: Date;
}

export class HeartbeatScheduler {
  private jobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private onNotification?: (n: HeartbeatNotification) => void;

  setNotificationHandler(fn: (n: HeartbeatNotification) => void) {
    this.onNotification = fn;
  }

  schedule(agent: Agent, interval: string) {
    const sessionId = agent.getSessionId();
    this.cancel(sessionId);

    const cronExpr = intervalToCron(interval);
    log.info(`Scheduling heartbeat for session "${sessionId}" with cron: ${cronExpr} (interval: ${interval})`);

    const job = cron.schedule(cronExpr, async () => {
      log.debug(`Running heartbeat for session: ${sessionId}`);
      try {
        const message = await agent.runHeartbeat();
        if (message) {
          log.info(`Heartbeat alert from "${sessionId}": ${message.slice(0, 100)}`);
          this.onNotification?.({
            sessionId,
            message,
            timestamp: new Date(),
          });
        }
      } catch (e) {
        log.error(`Heartbeat error for "${sessionId}":`, e);
      }
    });

    this.jobs.set(sessionId, job);
  }

  cancel(sessionId: string) {
    const job = this.jobs.get(sessionId);
    if (job) {
      job.stop();
      this.jobs.delete(sessionId);
    }
  }

  cancelAll() {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
  }
}
