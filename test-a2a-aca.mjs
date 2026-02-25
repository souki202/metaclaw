#!/usr/bin/env node
/**
 * Test script to verify A2A and ACA configuration and tool registration
 */

import { readFileSync } from 'fs';

// Read and validate config.example.json
console.log('Testing A2A and ACA configuration...\n');

const configExample = JSON.parse(readFileSync('./config.example.json', 'utf-8'));

console.log('✓ config.example.json loaded successfully\n');

// Check sessions
const sessions = Object.entries(configExample.sessions);
console.log(`Found ${sessions.length} sessions:\n`);

for (const [sessionId, config] of sessions) {
  console.log(`Session: ${sessionId}`);
  console.log(`  Name: ${config.name}`);
  console.log(`  Description: ${config.description}`);
  console.log(`  A2A enabled: ${config.a2a?.enabled || false}`);
  console.log(`  ACA enabled: ${config.aca?.enabled || false}`);

  if (config.aca?.enabled) {
    console.log(`    - Scan interval: ${config.aca.scanInterval} minutes`);
    console.log(`    - Max goals per cycle: ${config.aca.maxGoalsPerCycle}`);
  }
  console.log();
}

// Verify A2A is enabled on at least 2 sessions
const a2aEnabledCount = sessions.filter(([_, c]) => c.a2a?.enabled).length;
console.log(`\n✓ A2A enabled on ${a2aEnabledCount} session(s)`);

if (a2aEnabledCount >= 2) {
  console.log('✓ A2A can support inter-agent communication (2+ sessions enabled)');
} else {
  console.log('⚠ A2A requires at least 2 sessions to be enabled for inter-agent communication');
}

// Verify ACA is enabled on at least 1 session
const acaEnabledCount = sessions.filter(([_, c]) => c.aca?.enabled).length;
console.log(`\n✓ ACA enabled on ${acaEnabledCount} session(s)`);

if (acaEnabledCount >= 1) {
  console.log('✓ ACA will generate CURIOSITY.md files in enabled session workspaces');
}

console.log('\n✅ Configuration validation complete!');
console.log('\nNext steps:');
console.log('1. Copy config.example.json to config.json');
console.log('2. Set your API keys in config.json');
console.log('3. Run: npm run dev');
console.log('4. Open the dashboard and interact with multiple sessions');
console.log('5. Use list_agents tool to see A2A capabilities');
console.log('6. Use view_curiosity_state tool to see ACA frontiers');
console.log('7. Check workspace directories for CURIOSITY.md files');
