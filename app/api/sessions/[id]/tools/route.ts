import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const manager = getSessionManagerSafe();
    
    // Attempt to get the agent. If it's not active, getSessionManagerSafe will throw
    // or we might need to handle the case where it's not running.
    // However, the manager might not have the agent initialized if it's strictly a config page call.
    // Let's get the agent logic:
    const agent = manager.getAgent(id);
    if (!agent) {
      return notFound('Session agent not running');
    }

    const tools = await agent.getAvailableTools();

    return NextResponse.json({ tools });
  } catch (error) {
    return handleError(error);
  }
}
