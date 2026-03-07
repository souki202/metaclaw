import { PtyManager } from '../../../../../../src/tools/pty-manager';
import { getSessionManagerSafe, handleError, notFound } from '../../../../helpers';

export const dynamic = 'force-dynamic';

function encodeSsePayload(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const config = sessions.getSessionConfig(id);

    if (!config) {
      return notFound('Session not found');
    }

    const workspace = sessions.resolveWorkspace(config);
    const manager = PtyManager.getInstance();
    const instance = manager.getOrCreate(id, workspace);

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeSsePayload({ type: 'ready' }));

        for (const chunk of instance.buffer) {
          controller.enqueue(encodeSsePayload({ type: 'output', data: chunk }));
        }

        unsubscribe = manager.addDataListener(id, (data) => {
          try {
            controller.enqueue(encodeSsePayload({ type: 'output', data }));
          } catch {
            unsubscribe?.();
            unsubscribe = null;
          }
        });

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encodeSsePayload({ type: 'heartbeat' }));
          } catch {
            unsubscribe?.();
            unsubscribe = null;
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          }
        }, 15000);
      },
      cancel() {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}