
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody needed for Razorpay webhook signature
  app.setGlobalPrefix('api');
  // Lock CORS to known frontends via env (comma-separated).
  // Falls back to allow-all if CORS_ORIGINS is not set (dev convenience).
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : '*' });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3001;  // Render provides its own PORT
  await app.listen(port);
  console.log(`Backend running on port ${port}`);
}
bootstrap();
// import { NestFactory } from '@nestjs/core';
// import { ValidationPipe } from '@nestjs/common';
// import { AppModule } from './app.module';

// async function bootstrap() {
//   const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody needed for Razorpay webhook signature

//   app.enableCors();   // ← THIS LINE is what's missing

//   app.useGlobalPipes(
//     new ValidationPipe({ whitelist: true, transform: true }),
//   );

//   await app.listen(process.env.PORT ?? 3001);
//   console.log('Backend running on http://localhost:3001');
// }
// bootstrap();

