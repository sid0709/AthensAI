import cors from 'cors';
import express from 'express';
import { requestLogger } from '@nextoffer/shared/terminal-log';
import { loadConfigFromEnv, serverConfig } from './config.js';
import { createAiKit } from './kit.js';
import { errorMiddleware } from './middleware/error.js';
import { createRoutes } from './routes/index.js';

export function createAiBffApp(config = loadConfigFromEnv()) {
  const kit = createAiKit(config);
  const app = express();

  process.env.LOG_SERVICE = 'ai-bff';

  app.use(cors({ origin: serverConfig.corsOrigin }));
  app.use(express.json({ limit: '20mb' }));
  app.use(requestLogger('api'));
  app.use(createRoutes(kit));
  app.use(errorMiddleware);

  return { app, kit };
}

export async function startAiBffServer(config = loadConfigFromEnv()) {
  const { initDb } = await import('./db.js');
  await initDb();

  const { app, kit } = createAiBffApp(config);
  const port = serverConfig.port;

  app.listen(port, () => {
    console.log(`Avalon AI BFF listening on http://localhost:${port}`);
    console.log(`Configured providers: ${kit.getConfiguredProviders().join(', ') || '(none)'}`);
  });

  return app;
}
