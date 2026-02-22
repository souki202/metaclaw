import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { createLogger } from '../logger.js';

const log = createLogger('schedule');
const SCHEDULE_FILENAME = 'schedules.json';
const CHECK_INTERVAL_MS = 30_000;

export interface ScheduleTrigger {
  sessionId: string;
  schedule: SessionSchedule;
}

function normalizeRepeatCron(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'none') return null;
  if (!cron.validate(normalized)) {
    throw new Error(`Invalid cron expression: ${normalized}`);
  }
  return normalized;
}

function asDate(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} must be a valid ISO datetime string.`);
  }
  return d;
}

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCHours() === b.getUTCHours() &&
    a.getUTCMinutes() === b.getUTCMinutes()
  );
}

function computeNextRunAt(schedule: SessionSchedule, now = new Date()): string | null {
  const startAt = asDate(schedule.startAt, 'startAt');

  if (!schedule.enabled) {
    return null;
  }

  if (!schedule.repeatCron) {
    if (schedule.lastRunAt) return null;
    return startAt.getTime() >= now.getTime() ? startAt.toISOString() : now.toISOString();
  }

  if (!schedule.lastRunAt && startAt.getTime() >= now.getTime()) {
    return startAt.toISOString();
  }

  const base = startAt.getTime() > now.getTime() ? startAt : now;
  const expr = CronExpressionParser.parse(schedule.repeatCron, {
    currentDate: base,
    tz: 'UTC',
  });

  const next = expr.next().toDate();
  return next.toISOString();
}

export class ScheduleManager {
  private sessionItems = new Map<string, SessionSchedule[]>();
  private sessionWorkspaces = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private onTrigger?: (trigger: ScheduleTrigger) => Promise<void>;
  private isTickRunning = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.isTickRunning) return;
      this.isTickRunning = true;
      this.tick()
        .catch((e) => {
          log.error('Schedule tick failed:', e);
        })
        .finally(() => {
          this.isTickRunning = false;
        });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setTriggerHandler(fn: (trigger: ScheduleTrigger) => Promise<void>) {
    this.onTrigger = fn;
  }

  loadSession(sessionId: string, workspace: string) {
    this.sessionWorkspaces.set(sessionId, workspace);
    const items = this.readSessionFile(workspace)
      .map((item) => this.sanitizeLoadedItem(sessionId, item))
      .filter((item): item is SessionSchedule => item !== null)
      .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''));
    this.sessionItems.set(sessionId, items);
  }

  unloadSession(sessionId: string) {
    this.sessionItems.delete(sessionId);
    this.sessionWorkspaces.delete(sessionId);
  }

  list(sessionId: string): SessionSchedule[] {
    const items = this.sessionItems.get(sessionId) || [];
    return [...items].sort((a, b) => {
      const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  create(sessionId: string, input: ScheduleUpsertInput): SessionSchedule {
    const items = this.sessionItems.get(sessionId);
    if (!items) {
      throw new Error(`Session not loaded: ${sessionId}`);
    }

    const now = new Date();
    const schedule: SessionSchedule = {
      id: uuidv4(),
      sessionId,
      startAt: asDate(input.startAt, 'startAt').toISOString(),
      repeatCron: normalizeRepeatCron(input.repeatCron),
      memo: String(input.memo || '').trim(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: null,
      enabled: input.enabled ?? true,
    };

    if (!schedule.memo) {
      throw new Error('memo is required.');
    }

    schedule.nextRunAt = computeNextRunAt(schedule, now);
    items.push(schedule);
    this.persist(sessionId);
    return schedule;
  }

  update(sessionId: string, scheduleId: string, patch: Partial<ScheduleUpsertInput>): SessionSchedule {
    const items = this.sessionItems.get(sessionId);
    if (!items) {
      throw new Error(`Session not loaded: ${sessionId}`);
    }

    const idx = items.findIndex((s) => s.id === scheduleId);
    if (idx === -1) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    const current = items[idx];
    const nextRepeatCron = patch.repeatCron === undefined
      ? current.repeatCron
      : normalizeRepeatCron(patch.repeatCron);
    const nextStartAt = patch.startAt === undefined
      ? current.startAt
      : asDate(patch.startAt, 'startAt').toISOString();
    const nextMemo = patch.memo === undefined ? current.memo : String(patch.memo).trim();

    if (!nextMemo) {
      throw new Error('memo is required.');
    }

    const now = new Date();
    const updated: SessionSchedule = {
      ...current,
      startAt: nextStartAt,
      repeatCron: nextRepeatCron,
      memo: nextMemo,
      enabled: patch.enabled ?? current.enabled,
      updatedAt: now.toISOString(),
    };

    updated.nextRunAt = computeNextRunAt(updated, now);
    items[idx] = updated;
    this.persist(sessionId);
    return updated;
  }

  remove(sessionId: string, scheduleId: string): boolean {
    const items = this.sessionItems.get(sessionId);
    if (!items) {
      throw new Error(`Session not loaded: ${sessionId}`);
    }

    const before = items.length;
    const next = items.filter((s) => s.id !== scheduleId);
    this.sessionItems.set(sessionId, next);
    const changed = next.length !== before;
    if (changed) {
      this.persist(sessionId);
    }
    return changed;
  }

  private async tick() {
    const now = new Date();

    for (const [sessionId, items] of this.sessionItems.entries()) {
      let changed = false;

      for (let i = items.length - 1; i >= 0; i--) {
        const schedule = items[i];
        if (!schedule.enabled) continue;
        if (!schedule.nextRunAt) continue;

        const dueAt = new Date(schedule.nextRunAt);
        if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() > now.getTime()) {
          continue;
        }

        if (schedule.repeatCron && schedule.lastRunAt) {
          const last = new Date(schedule.lastRunAt);
          if (!Number.isNaN(last.getTime()) && sameMinute(last, now)) {
            continue;
          }
        }

        if (!this.onTrigger) {
          log.warn(`Schedule trigger handler is not set. Skipping schedule ${schedule.id}`);
          continue;
        }

        try {
          await this.onTrigger({
            sessionId,
            schedule: { ...schedule },
          });
        } catch (e) {
          log.error(`Failed to execute schedule ${schedule.id} for session ${sessionId}:`, e);
          continue;
        }

        if (!schedule.repeatCron) {
          items.splice(i, 1);
          changed = true;
          continue;
        }

        schedule.lastRunAt = now.toISOString();
        schedule.updatedAt = now.toISOString();
        schedule.nextRunAt = computeNextRunAt(schedule, new Date(now.getTime() + 1000));
        changed = true;
      }

      if (changed) {
        this.persist(sessionId);
      }
    }
  }

  private sanitizeLoadedItem(sessionId: string, item: SessionSchedule): SessionSchedule | null {
    try {
      const now = new Date();
      const schedule: SessionSchedule = {
        id: item.id || uuidv4(),
        sessionId,
        startAt: asDate(item.startAt, 'startAt').toISOString(),
        repeatCron: normalizeRepeatCron(item.repeatCron),
        memo: String(item.memo || '').trim(),
        createdAt: item.createdAt ? asDate(item.createdAt, 'createdAt').toISOString() : now.toISOString(),
        updatedAt: item.updatedAt ? asDate(item.updatedAt, 'updatedAt').toISOString() : now.toISOString(),
        lastRunAt: item.lastRunAt ? asDate(item.lastRunAt, 'lastRunAt').toISOString() : undefined,
        nextRunAt: null,
        enabled: item.enabled !== false,
      };

      if (!schedule.memo) return null;
      schedule.nextRunAt = computeNextRunAt(schedule, now);
      return schedule;
    } catch {
      return null;
    }
  }

  private sessionFilePath(workspace: string): string {
    return path.join(workspace, SCHEDULE_FILENAME);
  }

  private readSessionFile(workspace: string): SessionSchedule[] {
    const filePath = this.sessionFilePath(workspace);
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as SessionSchedule[];
    } catch {
      return [];
    }
  }

  private persist(sessionId: string) {
    const workspace = this.sessionWorkspaces.get(sessionId);
    if (!workspace) {
      throw new Error(`Workspace not found for session: ${sessionId}`);
    }

    const items = this.sessionItems.get(sessionId) || [];
    const filePath = this.sessionFilePath(workspace);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
  }
}
