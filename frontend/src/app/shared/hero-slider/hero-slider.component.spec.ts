import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeroSlider, SlideItem } from './hero-slider.component';

const SLIDES: SlideItem[] = [
  { slug: 'a', name: 'Evento A', imageUrl: 'https://img/a.jpg', categoryName: 'Conciertos' },
  { slug: 'b', name: 'Evento B', imageUrl: null },
  { slug: 'c', name: 'Evento C' },
];

describe('HeroSlider', () => {
  let fixture: ComponentFixture<HeroSlider>;
  let el: HTMLElement;

  function setup(slides: SlideItem[]) {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    fixture = TestBed.createComponent(HeroSlider);
    fixture.componentRef.setInput('slides', slides);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('no renderiza nada sin slides', () => {
    setup([]);
    expect(el.querySelector('.hero')).toBeNull();
  });

  it('renderiza un slide por evento y un punto por slide', () => {
    setup(SLIDES);
    expect(el.querySelectorAll('.hero-slide').length).toBe(3);
    expect(el.querySelectorAll('.hero-dot').length).toBe(3);
    expect(el.querySelector('.hero-dot.active')).toBe(el.querySelectorAll('.hero-dot')[0]);
  });

  it('la flecha siguiente avanza y da la vuelta al final', () => {
    setup(SLIDES);
    const next = el.querySelector('.hero-arrow.next') as HTMLButtonElement;
    next.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.hero-dot')[1].classList.contains('active')).toBe(true);
    next.click();
    next.click(); // de C vuelve a A
    fixture.detectChanges();
    expect(el.querySelectorAll('.hero-dot')[0].classList.contains('active')).toBe(true);
  });

  it('la flecha anterior desde el inicio va al último', () => {
    setup(SLIDES);
    (el.querySelector('.hero-arrow.prev') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.hero-dot')[2].classList.contains('active')).toBe(true);
  });

  it('un punto lleva directamente a ese slide', () => {
    setup(SLIDES);
    (el.querySelectorAll('.hero-dot')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.hero-track')?.getAttribute('style')).toContain('-200%');
  });

  it('con un solo slide no muestra flechas ni puntos', () => {
    setup([SLIDES[0]]);
    expect(el.querySelector('.hero-arrow')).toBeNull();
    expect(el.querySelector('.hero-dot')).toBeNull();
  });
});
