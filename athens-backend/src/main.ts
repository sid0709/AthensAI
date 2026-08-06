import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AuthResponseFilter());

  const origins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  const port = Number(process.env.PORT) || 8980;
  await app.listen(port);
  console.log(`athens-backend listening on http://127.0.0.1:${port}/api`);
}

bootstrap();
