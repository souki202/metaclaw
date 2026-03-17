import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';
import { isSkillEnabled, loadSkills } from '../../../../../src/core/skills';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const sessionConfig = sessions.getSessionConfig(id);
    const agent = sessions.getAgent(id);

    if (!sessionConfig) {
      return notFound('Session not found');
    }

    const includeAll = new URL(request.url).searchParams.get('all') === 'true';
    const workspace = agent?.getWorkspace() ?? sessions.resolveWorkspace(sessionConfig);
    const skills = loadSkills([process.cwd(), workspace]).map((skill) => ({
      name: skill.name,
      description: skill.description,
      enabled: isSkillEnabled(skill.name, sessionConfig),
    }));
    const result = includeAll
      ? skills
      : skills
        .filter((skill) => skill.enabled)
        .map(({ enabled: _enabled, ...skill }) => skill);

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
