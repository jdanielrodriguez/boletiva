import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { RichTextEditorComponent } from './rich-text-editor.component';

describe('RichTextEditorComponent (T6 · editor de formato)', () => {
  async function setup(initial = '') {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(RichTextEditorComponent);
    fixture.componentRef.setInput('value', initial);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza la toolbar y el cuerpo editable', async () => {
    const fixture = await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="rte-body"]')?.getAttribute('contenteditable')).toBe('true');
    expect(el.querySelectorAll('.rte-btn').length).toBeGreaterThan(4);
  });

  it('refleja el valor inicial en el cuerpo', async () => {
    const fixture = await setup('<p>hola</p>');
    const body = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="rte-body"]') as HTMLElement;
    expect(body.innerHTML).toContain('hola');
  });

  it('al editar emite el HTML por el modelo value', async () => {
    const fixture = await setup();
    const body = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="rte-body"]') as HTMLElement;
    body.innerHTML = '<p>nuevo</p>';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('<p>nuevo</p>');
  });
});
