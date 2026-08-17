import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';
import { loadAppConfig } from './config/app.config';
import { OakGatewayBootstrap } from './oak/gateway/oak-gateway.bootstrap';
import { backgroundWorkersMode } from './background-tasks/constants/task-types';

async function bootstrap() {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Resume bulk uploads + Oak DOM trees need a larger body limit.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'healthz', method: RequestMethod.GET },
    ],
  });
  // Lightweight request line so Extension scrape traffic is visible in the terminal.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && req.url?.includes('/jobs/bulk')) {
      const started = Date.now();
      res.on('finish', () => {
        console.log(
          `[http] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`,
        );
      });
    }
    next();
  });
  app.useGlobalFilters(new AuthResponseFilter());
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  });

  await app.listen(config.port);
  const mode = backgroundWorkersMode();
  if (mode !== 'worker') {
    const httpServer = app.getHttpServer();
    app.get(OakGatewayBootstrap).attach(httpServer);
    console.log(
      `athens-backend listening on http://127.0.0.1:${config.port}/api (Oak socket path /oak)`,
    );
  } else {
    console.log(
      `athens-backend worker listening on http://127.0.0.1:${config.port}/readyz`,
    );
  }
}

void bootstrap();
