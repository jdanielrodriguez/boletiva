import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { slugify } from '../../common/utils/slug';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
import { AvatarPresignDto, SetAvatarDto, UpdateProfileDto, UpdateUserRolesDto, UpdateUserStatusDto } from './dto/users.dto';

// Nunca exponer passwordHash. Incluye avatarKey (interno) para firmar avatarUrl al leer.
const publicSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  avatarKey: true,
  roles: true,
  status: true,
  // emailVerifiedAt/twoFactorMethod: imprescindibles para que el user devuelto por
  // ESTE módulo (updateProfile, tours, idioma/tema, avatar) traiga el MISMO shape que
  // /auth/me (PublicUserResponseDto). Si faltan, el setUser del front borra
  // emailVerified de la sesión → el modal de verificación reaparece indebidamente.
  emailVerifiedAt: true,
  twoFactorMethod: true,
  language: true,
  themePref: true,
  isTestUser: true,
  nit: true,
  billingName: true,
  dpi: true,
  toursSeen: true,
  promoterTier: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof publicSelect }>;

/** TTL de la URL firmada del avatar (6 h): larga para sesiones abiertas; se re-firma en cada /auth/me. */
const AVATAR_URL_TTL_S = 6 * 60 * 60;

/** Tipos de imagen permitidos para el avatar. SVG excluido a propósito (XSS). */
const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Presenta un usuario al cliente: si tiene `avatarKey` (foto subida) firma su URL de
   * lectura en caliente; si no, usa `avatarUrl` (URL externa/Google heredada). Nunca
   * expone `avatarKey`. Patrón de event-media (firmar al leer, no persistir URL firmada).
   */
  async present(
    user: SelectedUser,
  ): Promise<Omit<SelectedUser, 'avatarKey' | 'emailVerifiedAt'> & { emailVerified: boolean }> {
    const { avatarKey, avatarUrl, emailVerifiedAt, ...rest } = user;
    const url = avatarKey ? await this.storage.signedGetUrl(avatarKey, AVATAR_URL_TTL_S) : avatarUrl;
    // Exponemos `emailVerified` (booleano), NO la fecha — mismo contrato que /auth/me.
    return { ...rest, avatarUrl: url, emailVerified: emailVerifiedAt != null };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto, select: publicSelect });
    return this.present(user);
  }

  /** Marca un tour de onboarding como visto (idempotente: no duplica la clave). */
  async markTourSeen(userId: string, tour: string) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { toursSeen: true },
    });
    const seen = new Set([...current.toursSeen, tour]);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { toursSeen: [...seen] },
      select: publicSelect,
    });
    return this.present(user);
  }

  // --- Foto de perfil (opcional) ---

  /** URL firmada de subida directa navegador→storage para el avatar del usuario. */
  async presignAvatar(userId: string, dto: AvatarPresignDto) {
    // Whitelist de rásters seguros: SVG queda FUERA a propósito (puede llevar
    // <script> y ejecutarse si el contenido se sirviera desde el origen de la app) — H-09.
    if (!AVATAR_ALLOWED_TYPES.includes(dto.contentType)) {
      throw new BadRequestException('El avatar debe ser una imagen PNG, JPEG o WebP');
    }
    const safeName = slugify(dto.filename.replace(/\.[^.]+$/, '')) || 'avatar';
    const ext = (dto.filename.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const key = `avatars/${userId}/${randomUUID()}-${safeName}.${ext}`;
    const uploadUrl = await this.storage.signedPutUrl(key, dto.contentType);
    return { key, uploadUrl };
  }

  /** Confirma el avatar subido: valida que la key pertenezca al usuario y la guarda. */
  async setAvatar(userId: string, dto: SetAvatarDto) {
    if (!dto.key.startsWith(`avatars/${userId}/`)) {
      throw new BadRequestException('La imagen no pertenece a tu cuenta');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: dto.key, avatarUrl: null },
      select: publicSelect,
    });
    return this.present(user);
  }

  /** Quita la foto de perfil. */
  async clearAvatar(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null, avatarUrl: null },
      select: publicSelect,
    });
    return this.present(user);
  }

  async list(params: KeysetQuery & { search?: string }) {
    const { search } = params;
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.user.findMany({
      where,
      select: publicSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(params),
    });
    const presented = await Promise.all(rows.map((r) => this.present(r)));
    return keysetResult(presented, params);
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicSelect });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.present(user);
  }

  async setRoles(id: string, dto: UpdateUserRolesDto) {
    await this.assertExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { roles: dto.roles },
      select: publicSelect,
    });
    return this.present(user);
  }

  async setStatus(id: string, dto: UpdateUserStatusDto) {
    await this.assertExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: publicSelect,
    });
    return this.present(user);
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Usuario no encontrado');
  }

  /** Firma el avatar de un `User` completo (usado por auth para /auth/me). */
  async signAvatar(user: Pick<User, 'avatarKey' | 'avatarUrl'>): Promise<string | null> {
    if (user.avatarKey) return this.storage.signedGetUrl(user.avatarKey, AVATAR_URL_TTL_S);
    return user.avatarUrl;
  }
}
