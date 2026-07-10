import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  async function render(name: string, size?: number) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', name);
    if (size != null) fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renderiza un SVG con el trazo del icono pedido', async () => {
    const el = await render('edit');
    const svg = el.querySelector('svg.app-icon');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelector('path')).not.toBeNull();
  });

  it('respeta el tamaño configurado', async () => {
    const el = await render('save', 24);
    const svg = el.querySelector('svg.app-icon');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('el icono de asientos usa rects', async () => {
    const el = await render('seats');
    expect(el.querySelectorAll('svg rect').length).toBeGreaterThan(0);
  });
});
