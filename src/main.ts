import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
