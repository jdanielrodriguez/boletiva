import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShareBox } from './share-box.component';

describe('ShareBox', () => {
  let fixture: ComponentFixture<ShareBox>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ShareBox);
    fixture.componentRef.setInput('url', 'http://localhost:4200/reserva/tok-1');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('arma los enlaces de WhatsApp/Facebook/X con el url', () => {
    const enc = encodeURIComponent('http://localhost:4200/reserva/tok-1');
    const wa = el.querySelector('.share-btn.wa') as HTMLAnchorElement;
    const fb = el.querySelector('.share-btn.fb') as HTMLAnchorElement;
    const x = el.querySelector('.share-btn.x') as HTMLAnchorElement;
    expect(wa.href).toContain('wa.me');
    expect(wa.href).toContain(enc);
    expect(fb.href).toContain('facebook.com/sharer');
    expect(fb.href).toContain(enc);
    expect(x.href).toContain('twitter.com/intent');
    expect(x.href).toContain(enc);
  });

  it('copiar link usa el portapapeles y muestra confirmación', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    (el.querySelector('[data-testid="share-copy"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('http://localhost:4200/reserva/tok-1');
    expect(el.querySelector('[data-testid="share-copy"]')?.textContent).toContain('copiado');
  });
});
