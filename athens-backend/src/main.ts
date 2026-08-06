import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';
import { loadAppConfig } from './config/app.config';

async function bootstrap() {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
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
