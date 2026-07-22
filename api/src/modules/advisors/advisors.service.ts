import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.types';

/**
 * Gestión de ASESORES (admin). El asesor es un COMPRADOR con permisos especiales (rol
 * `advisor`). Por eso:
 *  - DESHABILITAR = quitar el rol `advisor` → el usuario queda como CLIENTE y sigue
 *    usando la plataforma como comprador ("continuar como cliente" es el resultado
 *    natural). Se le avisa. Su token pierde el rol al refrescar (acceso corto).
 *  - HABILITAR = volver a añadir el rol `advisor` (y reactivar si estaba inactivo).
 *  - ELIMINAR (solo tras deshabilitar) = soft-delete (status `inactive`): bloquea el
 *    login y preserva el rastro (ledger/órdenes). Reversible por el admin.
 *  - NOTIFICAR = aviso in-app al asesor.
 */
@Injectable()
export class AdvisorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Lista los asesores ACTUALES (rol advisor) y los DESHABILITADOS (wasAdvisor), para el
   *  panel del admin. Excluye los eliminados (status inactive). */
  async list() {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [{ roles: { has: Role.advisor } }, { wasAdvisor: true }],
        status: { not: UserStatus.inactive },
      },
      select: { id: true, email: true, firstName: true, lastName: true, status: true, roles: true, passwordHash: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      /** true = deshabilitado (ya no tiene el rol advisor) → el admin puede eliminarlo. */
      disabled: !u.roles.includes(Role.advisor),
      /** Sin contraseña = cuenta creada al invitar (forzada); útil para decidir el borrado. */
      forced: !u.passwordHash,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  private async getAdvisor(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.roles.includes(Role.advisor)) throw new NotFoundException('Asesor no encontrado');
    if (user.roles.includes(Role.admin)) throw new ForbiddenException('No se puede gestionar a un administrador');
    return user;
  }

  /** Deshabilita: quita el rol `advisor` (el usuario continúa como cliente). Avisa. */
  async disable(id: string) {
    const user = await this.getAdvisor(id);
    const roles = user.roles.filter((r) => r !== Role.advisor);
    // Garantiza que quede al menos como comprador (nunca sin roles).
    if (!roles.includes(Role.buyer)) roles.push(Role.buyer);
    // `wasAdvisor` → el panel lo sigue mostrando (deshabilitado) para poder eliminarlo.
    await this.prisma.user.update({ where: { id }, data: { roles: { set: roles }, wasAdvisor: true } });
    await this.notifications.emit(id, {
      type: NotificationType.ADMIN_MESSAGE,
      title: 'Tu rol de asesor fue deshabilitado',
      body: 'Ya no tienes acceso al panel de soporte, pero tu cuenta sigue activa como cliente de Boletiva.',
    });
    return { id, disabled: true };
  }

  /** Re-habilita: vuelve a añadir el rol `advisor` (reactiva si estaba inactivo). */
  async enable(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.roles.includes(Role.admin)) throw new ForbiddenException('No se puede gestionar a un administrador');
    const roles = [...new Set([...user.roles, Role.advisor])];
    await this.prisma.user.update({
      where: { id },
      data: { roles: { set: roles }, status: UserStatus.active },
    });
    return { id, enabled: true };
  }

  /** Elimina (soft): solo si YA está deshabilitado (sin rol advisor). Bloquea login. */
  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.roles.includes(Role.admin)) throw new ForbiddenException('No se puede eliminar a un administrador');
    if (user.roles.includes(Role.advisor)) {
      throw new BadRequestException('Primero deshabilita al asesor (quítale el rol) antes de eliminar');
    }
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.inactive } });
    return { id, removed: true };
  }

  /** Envía una notificación in-app a un asesor concreto. */
  async notify(id: string, title: string, body: string) {
    await this.getAdvisor(id);
    await this.notifications.emit(id, { type: NotificationType.ADMIN_MESSAGE, title, body });
    return { id, notified: true };
  }
}
