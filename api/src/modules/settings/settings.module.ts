import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { PublicConfigController } from './public-config.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController, PublicConfigController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
