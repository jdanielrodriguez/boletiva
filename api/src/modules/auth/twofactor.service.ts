import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChallengesService } from './challenges.service';

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: ChallengesService,
  ) {}

  /** Inicia el alta de TOTP: genera secret pendiente + URL otpauth + QR (data URL). */
  async setupTotp(
    userId: string,
  ): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: secret } });
    const otpauthUrl = authenticator.keyuri(user.email, 'Pasa Eventos', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrDataUrl, secret };
  }

  /** Confirma el TOTP con un código de la app y lo deja como método activo. */
  async enableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpPendingSecret)
      throw new BadRequestException('No hay configuración de TOTP pendiente');
    if (!authenticator.verify({ token: code, secret: user.totpPendingSecret })) {
      throw new BadRequestException('Código inválido');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        twoFactorMethod: 'totp',
      },
    });
  }

  /** Vuelve al 2FA por correo (no se puede quedar sin 2FA una vez verificado el email). */
  async useEmailMethod(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: 'email', totpSecret: null, totpPendingSecret: null },
    });
  }

  /** Dispara el segundo factor según el método del usuario (email envía código; totp no envía nada). */
  async startChallenge(user: User): Promise<void> {
    if (user.twoFactorMethod === 'email') {
      await this.challenges.issue(user.id, user.email, 'twofa_email');
    }
  }

  /** Verifica el segundo factor (código de la app o código enviado por correo). */
  async verify(user: User, code: string): Promise<void> {
    if (user.twoFactorMethod === 'totp') {
      if (!user.totpSecret || !authenticator.verify({ token: code, secret: user.totpSecret })) {
        throw new BadRequestException('Código de verificación inválido');
      }
      return;
    }
    // Método email: consume el reto twofa_email (lanza si es inválido/expirado).
    await this.challenges.consumeByCode(user.id, 'twofa_email', code);
  }
}
