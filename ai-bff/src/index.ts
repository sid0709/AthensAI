import { installTerminalLogger } from '@nextoffer/shared/terminal-log';

installTerminalLogger('ai-bff');

import { startAiBffServer } from './server.js';

startAiBffServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
