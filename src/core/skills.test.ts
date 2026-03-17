import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildSkillsPromptText, isSkillEnabled, loadSkills } from './skills.js';

function writeSkill(baseDir: string, name: string, description: string) {
  const skillDir = path.join(baseDir, '.agents', 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      '---',
      '',
      `Use the ${name} skill.`,
      '',
    ].join('\n'),
    'utf-8',
  );
}

test('buildSkillsPromptText excludes disabled session skills', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-claw-skills-'));

  try {
    writeSkill(tempDir, 'alpha', 'Alpha skill');
    writeSkill(tempDir, 'beta', 'Beta skill');

    const loaded = loadSkills([tempDir]);
    assert.equal(loaded.length, 2);
    assert.equal(isSkillEnabled('alpha', { disabledSkills: ['beta'] }), true);
    assert.equal(isSkillEnabled('beta', { disabledSkills: ['beta'] }), false);

    const prompt = buildSkillsPromptText([tempDir], {
      disabledSkills: ['beta'],
    });

    assert.ok(prompt.includes('### Skill: alpha'));
    assert.equal(prompt.includes('### Skill: beta'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
