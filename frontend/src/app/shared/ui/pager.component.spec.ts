import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PagerComponent } from './pager.component';

describe('PagerComponent (paginador compartido, estilo numerado del inicio)', () => {
  let fixture: ComponentFixture<PagerComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  function setup(page: number, totalPages: number, alwaysShow = false): void {
    fixture = TestBed.createComponent(PagerComponent);
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('totalPages', totalPages);
    fixture.componentRef.setInput('alwaysShow', alwaysShow);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('resalta la página actual con su número', () => {
    setup(2, 5);
    expect(el().querySelector('[data-testid="pager-current"]')?.textContent?.trim()).toBe('2');
    expect(el().querySelector('.pager-page.is-current')?.textContent?.trim()).toBe('2');
  });

  it('muestra todas las páginas con ≤7 y numeradas', () => {
    setup(1, 5);
    const pages = [...el().querySelectorAll('.pager-page')].map((b) => b.textContent?.trim());
    expect(pages).toEqual(['1', '2', '3', '4', '5']);
    expect(el().querySelectorAll('.pager-gap').length).toBe(0);
  });

  it('muestra huecos (…) con la primera/última en rangos grandes', () => {
    setup(5, 10);
    expect(el().querySelectorAll('.pager-gap').length).toBe(2);
    const pages = [...el().querySelectorAll('.pager-page')].map((b) => b.textContent?.trim());
    expect(pages).toContain('1');
    expect(pages).toContain('10');
    expect(pages).toContain('5');
  });

  it('se oculta con una sola página (salvo alwaysShow)', () => {
    setup(1, 1);
    expect(el().querySelector('[data-testid="pager"]')).toBeNull();
    setup(1, 1, true);
    expect(el().querySelector('[data-testid="pager"]')).not.toBeNull();
  });

  it('deshabilita primero/anterior en la primera y siguiente/última en la última', () => {
    setup(1, 3);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="pager-first"]')?.disabled).toBe(true);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="pager-prev"]')?.disabled).toBe(true);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="pager-next"]')?.disabled).toBe(false);
    setup(3, 3);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="pager-next"]')?.disabled).toBe(true);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="pager-last"]')?.disabled).toBe(true);
  });

  it('emite pageChange acotado a [1, total] con flechas y números', () => {
    setup(2, 4);
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));
    el().querySelector<HTMLButtonElement>('[data-testid="pager-next"]')!.click();
    el().querySelector<HTMLButtonElement>('[data-testid="pager-prev"]')!.click();
    el().querySelector<HTMLButtonElement>('[data-testid="pager-first"]')!.click();
    el().querySelector<HTMLButtonElement>('[data-testid="pager-last"]')!.click();
    expect(emitted).toEqual([3, 1, 1, 4]);
  });
});
