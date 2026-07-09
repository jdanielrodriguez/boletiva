import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { CategoriesApi } from '../../core/api/categories.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import type {
  CategoryResponseDto,
  CreatedInvitationDto,
  InvitationListItemDto,
  LocalityView,
  ManagedEventDetailDto,
} from '../../core/api/types';

type Section = 'eventos' | 'invitaciones';

/**
 * Panel del promotor (F4): autoservicio para crear/gestionar eventos (publicar,
 * cancelar, banner con IA, localidades) e invitar a otros promotores por correo.
 * Ruta protegida (roleGuard promoter/admin).
 */
@Component({
  selector: 'app-promoter-panel',
  imports: [FormsModule, DatePipe],
  templateUrl: './promoter-panel.html',
})
export class PromoterPanel {
  private readonly eventsApi = inject(PromoterEventsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly invitationsApi = inject(InvitationsApi);

  protected readonly section = signal<Section>('eventos');
  protected readonly error = signal<string | null>(null);

  // --- Eventos ---
  protected readonly events = signal<ManagedEventDetailDto[]>([]);
  protected readonly categories = signal<CategoryResponseDto[]>([]);
  protected readonly creating = signal(false);
  protected readonly form = {
    name: signal(''),
    categoryId: signal(''),
    startsAt: signal(''),
    endsAt: signal(''),
    description: signal(''),
  };
  /** Localidades por evento (cargadas al expandir) + evento expandido. */
  protected readonly expanded = signal<string | null>(null);
  protected readonly localities = signal<Record<string, LocalityView[]>>({});
  protected readonly locForm = {
    name: signal(''),
    kind: signal<'seated' | 'general'>('general'),
    capacity: signal<number | null>(null),
    desiredNet: signal<number | null>(null),
  };
  /** Banner recién generado por evento (URL). */
  protected readonly banners = signal<Record<string, string>>({});

  // --- Invitaciones ---
  protected readonly emailsText = signal('');
  protected readonly created = signal<CreatedInvitationDto[]>([]);
  protected readonly invitations = signal<InvitationListItemDto[]>([]);
  protected readonly inviting = signal(false);

  constructor() {
    this.loadEvents();
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
  }

  protected select(s: Section): void {
    this.section.set(s);
    if (s === 'invitaciones' && this.invitations().length === 0) this.loadInvitations();
  }

  // --- Eventos ---
  private loadEvents(): void {
    this.eventsApi.mine().subscribe({
      next: (e) => this.events.set(e),
      error: () => this.events.set([]),
    });
  }

  protected createEvent(): void {
    if (!this.form.name() || !this.form.startsAt() || !this.form.endsAt()) {
      this.error.set('Completa nombre y fechas del evento.');
      return;
    }
    this.creating.set(true);
    this.error.set(null);
    this.eventsApi
      .create({
        name: this.form.name(),
        startsAt: new Date(this.form.startsAt()).toISOString(),
        endsAt: new Date(this.form.endsAt()).toISOString(),
        categoryId: this.form.categoryId() || undefined,
        description: this.form.description() || undefined,
        // El comprador paga igual en cuotas; por defecto las absorbe la plataforma
        // (no el promotor) y el IVA aplica sobre el neto (evento estándar).
        ivaOnNet: true,
        absorbInstallmentCost: false,
      })
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.form.name.set('');
          this.form.description.set('');
          this.loadEvents();
        },
        error: () => {
          this.creating.set(false);
          this.error.set('No se pudo crear el evento. Revisa las fechas.');
        },
      });
  }

  protected publish(id: string): void {
    this.eventsApi.publish(id).subscribe({ next: () => this.loadEvents(), error: () => this.error.set('No se pudo publicar (¿faltan localidades?).') });
  }

  protected cancelEvent(id: string): void {
    this.eventsApi.cancel(id).subscribe({ next: () => this.loadEvents(), error: () => undefined });
  }

  protected generateBanner(id: string): void {
    this.eventsApi.generateBanner(id).subscribe({
      next: (b) => this.banners.update((cur) => ({ ...cur, [id]: b.url })),
      error: () => this.error.set('No se pudo generar el banner.'),
    });
  }

  // --- Localidades ---
  protected toggleLocalities(eventId: string): void {
    if (this.expanded() === eventId) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(eventId);
    if (!this.localities()[eventId]) this.loadLocalities(eventId);
  }

  private loadLocalities(eventId: string): void {
    this.eventsApi.localities(eventId).subscribe({
      next: (l) => this.localities.update((cur) => ({ ...cur, [eventId]: l })),
      error: () => this.localities.update((cur) => ({ ...cur, [eventId]: [] })),
    });
  }

  protected addLocality(eventId: string): void {
    if (!this.locForm.name()) {
      this.error.set('La localidad necesita un nombre.');
      return;
    }
    const kind = this.locForm.kind();
    this.eventsApi
      .addLocality(eventId, {
        name: this.locForm.name(),
        kind,
        capacity: kind === 'general' ? this.locForm.capacity() ?? undefined : undefined,
        desiredNet: this.locForm.desiredNet() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.locForm.name.set('');
          this.locForm.capacity.set(null);
          this.locForm.desiredNet.set(null);
          this.loadLocalities(eventId);
        },
        error: () => this.error.set('No se pudo agregar la localidad.'),
      });
  }

  // --- Invitaciones ---
  private loadInvitations(): void {
    this.invitationsApi.list().subscribe({
      next: (i) => this.invitations.set(i),
      error: () => this.invitations.set([]),
    });
  }

  protected readonly parsedEmails = computed(() =>
    this.emailsText()
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean),
  );

  protected invite(): void {
    const emails = this.parsedEmails();
    if (emails.length === 0) {
      this.error.set('Ingresa al menos un correo.');
      return;
    }
    this.inviting.set(true);
    this.error.set(null);
    this.invitationsApi.create(emails).subscribe({
      next: (res) => {
        this.inviting.set(false);
        this.created.set(res.invitations);
        this.emailsText.set('');
        this.loadInvitations();
      },
      error: () => {
        this.inviting.set(false);
        this.error.set('No se pudieron crear las invitaciones (revisa los correos).');
      },
    });
  }

  protected revoke(id: string): void {
    this.invitationsApi.revoke(id).subscribe({ next: () => this.loadInvitations(), error: () => undefined });
  }
}
