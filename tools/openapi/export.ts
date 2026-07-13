// Exporta el documento OpenAPI a docs/openapi.json sin levantar el servidor HTTP.
// Reproduce la config de Swagger de api/src/main.ts (prefijo /api/v1 + bearer auth).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../../api/src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const doc = new DocumentBuilder()
    .setTitle('Pasa Eventos API')
    .setDescription('API de la boletera Pasa Eventos')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, doc);
  const out = join(process.cwd(), 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI exportado a ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
