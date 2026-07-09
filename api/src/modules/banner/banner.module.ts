import { Module } from '@nestjs/common';
import { BannerController } from './banner.controller';
import { BannerService } from './banner.service';
import { BANNER_PROVIDER } from './banner.provider';
import { StubBannerProvider } from './providers/stub-banner.provider';

/**
 * Generación de banners con IA (F4). Hoy corre el stub (SVG branded); al integrar
 * Gemini se cambia el proveedor aquí (o por config) sin tocar el servicio.
 */
@Module({
  controllers: [BannerController],
  providers: [BannerService, { provide: BANNER_PROVIDER, useClass: StubBannerProvider }],
})
export class BannerModule {}
