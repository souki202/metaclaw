import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';
import { loadSkills } from '../../../../../src/core/skills';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    const skills = loadSkills([process.cwd(), agent.getWorkspace()]);
    const result = skills.map((s) => ({ name: s.name, description: s.description }));

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
