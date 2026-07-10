import {
  Component,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Ítem del slider (desacoplado del SDK para testear sin dependencias). */
export interface SlideItem {
  slug: string;
  name: string;
  imageUrl?: string | null;
  categoryName?: string | null;
}

const AUTOPLAY_MS = 6000;

/**
 * Slider "hero" de eventos promocionados: ocupa la mayoría del inicio, avanza
 * solo (autoplay), con flechas y puntitos. El autoplay solo corre en navegador.
 * La priorización/edición vive en el backend (promotedPriority); aquí solo se
 * muestran los que llegan, ya ordenados.
 */
@Component({
  selector: 'app-hero-slider',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './hero-slider.component.html',
})
export class HeroSlider implements OnDestroy {
  readonly slides = input<SlideItem[]>([]);

  protected readonly index = signal(0);
  protected readonly count = computed(() => this.slides().length);
  protected readonly offset = computed(() => -this.index() * 100);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Mantiene el índice dentro de rango si cambia la cantidad de slides.
    effect(() => {
      const n = this.count();
      if (n > 0 && this.index() >= n) this.index.set(0);
    });
    afterNextRender(() => this.startAutoplay());
  }

  protected next(): void {
    const n = this.count();
    if (n > 0) this.index.set((this.index() + 1) % n);
  }

  protected prev(): void {
    const n = this.count();
    if (n > 0) this.index.set((this.index() - 1 + n) % n);
  }

  protected goTo(i: number): void {
    this.index.set(i);
    this.restartAutoplay();
  }

  protected onArrow(dir: 1 | -1): void {
    if (dir === 1) this.next();
    else this.prev();
    this.restartAutoplay();
  }

  private startAutoplay(): void {
    if (this.count() <= 1) return;
    this.timer = setInterval(() => this.next(), AUTOPLAY_MS);
  }

  private restartAutoplay(): void {
    if (this.timer) clearInterval(this.timer);
    this.startAutoplay();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
