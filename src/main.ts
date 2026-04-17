import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const corsOriginRaw = config.getOrThrow<string>('CORS_ORIGIN').trim();
  app.enableCors({
    origin: corsOriginRaw,
    credentials: true,
  });
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
