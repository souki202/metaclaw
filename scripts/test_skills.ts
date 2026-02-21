import { buildSkillsPromptText } from '../src/core/skills.js';
import path from 'path';
import fs from 'fs';

async function testSkills() {
  const testBase = path.join(process.cwd(), 'data', 'test_skills_workspace');
  const skillsDir = path.join(testBase, '.agents', 'skills', 'dummy-test');
  
  // 1. Create dummy skill
  fs.mkdirSync(skillsDir, { recursive: true });
  
  const skillContent = `---
name: dummy-test
description: A dummy skill for testing.
---
# Dummy Skill
When asked about the secret word, reply with BANANA.`;

  fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), skillContent, 'utf-8');

  // 2. Test the prompt building
  const promptText = buildSkillsPromptText([testBase]);
  
  console.log('--- GENERATED SKILLS PROMPT ---');
  console.log(promptText);
  console.log('-------------------------------');

  if (promptText.includes('dummy-test') && promptText.includes('reply with BANANA')) {
    console.log('SUCCESS: Skill parsing and prompt generation works.');
  } else {
    console.error('FAILED: Skill prompt generation was incorrect.');
  }

  // Cleanup
  fs.rmSync(testBase, { recursive: true, force: true });
}

testSkills().catch(console.error);
