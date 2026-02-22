import { NextResponse } from 'next/server';
import { handleError } from '../helpers';
import { loadSkills } from '../../../src/core/skills';
import type { Skill } from '../../../src/core/skills';

export async function GET() {
  try {
    const skills = loadSkills([process.cwd()]);
    return NextResponse.json(
      skills.map((s: Skill) => ({ name: s.name, description: s.description }))
    );
  } catch (error) {
    return handleError(error);
  }
}
