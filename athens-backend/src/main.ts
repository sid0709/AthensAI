import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';
import { loadAppConfig } from './config/app.config';

async function bootstrap() {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Resume library bulk uploads send base64 file payloads (default Express limit is ~100kb).
  app.useBodyParser('json', { limit: '32mb' });
  app.useBodyParser('urlencoded', { limit: '32mb', extended: true });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'healthz', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new AuthResponseFilter());
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  });

  await app.listen(config.port);
  console.log(
    `athens-backend listening on http://127.0.0.1:${config.port}/api`,
  );
}

void bootstrap();
