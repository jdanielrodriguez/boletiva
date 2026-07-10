import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PagerComponent } from './pager.component';

describe('PagerComponent (paginador compartido)', () => {
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

  it('muestra "n / total"', () => {
    setup(2, 5);
    expect(el().querySelector('[data-testid="pager-current"]')?.textContent?.trim()).toBe('2 / 5');
  });

  it('se oculta con una sola página (salvo alwaysShow)', () => {
    setup(1, 1);
    expect(el().querySelector('[data-testid="pager"]')).toBeNull();
    setup(1, 1, true);
    expect(el().querySelector('[data-testid="pager"]')).not.toBeNull();
  });

  it('deshabilita anterior en la primera y siguiente en la última', () => {
    setup(1, 3);
    const prev = el().querySelector<HTMLButtonElement>('[data-testid="pager-prev"]');
    expect(prev?.disabled).toBe(true);
    setup(3, 3);
    const next = el().querySelector<HTMLButtonElement>('[data-testid="pager-next"]');
    expect(next?.disabled).toBe(true);
  });

  it('emite pageChange acotado a [1, total]', () => {
    setup(2, 4);
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));
    el().querySelector<HTMLButtonElement>('[data-testid="pager-next"]')!.click();
    el().querySelector<HTMLButtonElement>('[data-testid="pager-prev"]')!.click();
    expect(emitted).toEqual([3, 1]);
  });
});
