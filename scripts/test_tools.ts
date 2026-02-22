import { executeTool } from '../src/tools/index.js';
import { QuickMemory } from '../src/memory/quick.js';
import path from 'path';
import fs from 'fs';

async function runTests() {
  const workspace = path.join(process.cwd(), 'data', 'test_workspace');
  fs.mkdirSync(workspace, { recursive: true });

  const ctx = {
    sessionId: 'test',
    config: {
      workspace,
      restrictToWorkspace: false,
      allowSelfModify: true,
      tools: {}
    } as any,
    workspace,
    tmpMemory: new QuickMemory(workspace, 'TMP_MEMORY.md'),
  };

  console.log('Testing self_edit...');
  const testFilePath = 'tools/test_edit.ts';
  const fullPath = path.join(process.cwd(), 'src', testFilePath);
  
  // Create a dummy file in src
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, 'const a = "old_value";', 'utf-8');

  // Test self_edit
  const editRes = await executeTool('self_edit', {
    path: testFilePath,
    old_string: 'old_value',
    new_string: 'new_value'
  }, ctx);

  console.log('self_edit result:', editRes);
  const updatedContent = fs.readFileSync(fullPath, 'utf-8');
  console.log('updated content:', updatedContent);
  if (updatedContent.includes('new_value')) {
    console.log('self_edit working correctly.');
  } else {
    console.error('self_edit failed!');
  }

  // Cleanup
  fs.unlinkSync(fullPath);

  console.log('\nTesting TMP_MEMORY...');
  const tmpRes = await executeTool('memory_update_tmp', { content: 'test memory 123' }, ctx);
  console.log('memory_update_tmp result:', tmpRes);

  const memContent = fs.readFileSync(path.join(workspace, 'TMP_MEMORY.md'), 'utf-8');
  console.log('TMP_MEMORY content:', memContent);
  if (memContent === 'test memory 123') {
    console.log('memory_update_tmp working correctly.');
  }

  const clearRes = await executeTool('memory_clear_tmp', {}, ctx);
  console.log('memory_clear_tmp result:', clearRes);
  const memContent2 = fs.readFileSync(path.join(workspace, 'TMP_MEMORY.md'), 'utf-8');
  if (memContent2 === '') {
    console.log('memory_clear_tmp working correctly.');
  }

  console.log('\nAll basic tool tests completed.');
}

runTests().catch(console.error);
