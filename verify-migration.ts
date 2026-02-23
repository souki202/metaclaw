import { ensureBuiltinMcpServer } from './src/config.js';
import type { SessionConfig } from './src/types.js';

console.log('Testing consult-ai migration...');

const sessionWithOldConfig: any = {
  name: 'Test Session',
  provider: {
    endpoint: 'https://old-endpoint.com',
    apiKey: 'old-key',
    model: 'old-model'
  },
  mcpServers: {
    'consult-ai': {
      type: 'builtin-consult',
      endpointUrl: 'https://custom-endpoint.com',
      apiKey: 'custom-key',
      model: 'custom-model',
      enabled: true
    }
  }
};

ensureBuiltinMcpServer(sessionWithOldConfig);

console.log('Migrated Config:', JSON.stringify(sessionWithOldConfig.consultAi, null, 2));
if (sessionWithOldConfig.consultAi.endpointUrl === 'https://custom-endpoint.com' && !sessionWithOldConfig.mcpServers['consult-ai']) {
  console.log('✅ Migration successful');
} else {
  console.log('❌ Migration failed');
  process.exit(1);
}

const sessionWithoutConfig: any = {
  name: 'New Session',
  provider: {
    endpoint: 'https://provider-endpoint.com',
    apiKey: 'provider-key',
    model: 'provider-model'
  }
};

ensureBuiltinMcpServer(sessionWithoutConfig);
console.log('Initialized Config:', JSON.stringify(sessionWithoutConfig.consultAi, null, 2));
if (sessionWithoutConfig.consultAi.endpointUrl === 'https://provider-endpoint.com') {
  console.log('✅ Initialization successful');
} else {
  console.log('❌ Initialization failed');
  process.exit(1);
}
