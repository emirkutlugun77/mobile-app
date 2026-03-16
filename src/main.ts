import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Intellectual API')
    .setDescription('Backend API for the Intellectual daily fact learning app')
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-Device-ID', in: 'header' },
      'X-Device-ID',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Intellectual API running on port ${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/docs`);
}
bootstrap();
