import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { ChallengesService } from './challenges.service';
import { DevicesService } from './devices.service';
import { TwoFactorService } from './twofactor.service';
import { GoogleAuthService } from './google.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CaptchaModule } from '../../infra/captcha/captcha.module';
import { CaptchaGuard } from '../../common/guards/captcha.guard';

@Module({
  imports: [PassportModule, JwtModule.register({}), CaptchaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    ChallengesService,
    DevicesService,
    TwoFactorService,
    GoogleAuthService,
    JwtStrategy,
    CaptchaGuard,
  ],
  exports: [AuthService, TokensService, DevicesService, TwoFactorService, ChallengesService],
})
export class AuthModule {}
