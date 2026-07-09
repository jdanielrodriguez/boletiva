import { Component, computed, input, signal } from '@angular/core';

/**
 * Compartir un link (reserva) por WhatsApp/Facebook/X + copiar. Pensado para que
 * alguien reserve boletos y le mande el link a otra persona para que pague.
 */
@Component({
  selector: 'app-share-box',
  templateUrl: './share-box.component.html',
})
export class ShareBox {
  readonly url = input.required<string>();
  readonly title = input('Te comparto esta reserva de boletos en Pasa Eventos');

  protected readonly copied = signal(false);

  private readonly encUrl = computed(() => encodeURIComponent(this.url()));
  private readonly encText = computed(() => encodeURIComponent(this.title()));

  protected readonly whatsapp = computed(() => `https://wa.me/?text=${this.encText()}%20${this.encUrl()}`);
  protected readonly facebook = computed(() => `https://www.facebook.com/sharer/sharer.php?u=${this.encUrl()}`);
  protected readonly x = computed(() => `https://twitter.com/intent/tweet?text=${this.encText()}&url=${this.encUrl()}`);

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }
}
