import { escapeHtml, renderEmail, EMAIL_THEMES } from './email-template';

describe('email-template', () => {
  describe('escapeHtml', () => {
    it('escapa los caracteres peligrosos (anti-inyección en el correo)', () => {
      expect(escapeHtml('<script>alert("x")</script>')).toBe(
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
      );
      expect(escapeHtml("O'Brien & Co")).toBe('O&#39;Brien &amp; Co');
    });
  });

  describe('renderEmail', () => {
    it('rellena marca, título y cuerpo; produce HTML + texto plano', () => {
      const { html, text } = renderEmail({
        title: 'Verifica tu correo',
        bodyHtml: '<p>Hola mundo</p>',
        preheader: 'Vista previa',
      });
      expect(html).toContain('Verifica tu correo');
      expect(html).toContain('<p>Hola mundo</p>');
      expect(html).toContain('Vista previa');
      // Marca "bolet"+"iva" y footer Boletiva con el año actual.
      expect(html).toContain('>bolet<');
      expect(html).toContain('>iva<');
      expect(html).toContain('Boletiva');
      expect(html).toContain(String(new Date().getFullYear()));
      // Sin paleta explícita: usa el tema por defecto (Pulso/noche, fondo oscuro).
      expect(html).toContain('#0a0d13');
      // El texto plano deriva del cuerpo (sin etiquetas).
      expect(text).toContain('Verifica tu correo');
      expect(text).toContain('Hola mundo');
      expect(text).not.toContain('<p>');
    });

    it('incluye el bloque CTA (HTML + texto) cuando hay cta', () => {
      const { html, text } = renderEmail({
        title: 'Recupera tu contraseña',
        bodyHtml: '<p>Restablece</p>',
        cta: { url: 'https://x.test/reset?token=abc', label: 'Restablecer' },
      });
      expect(html).toContain('https://x.test/reset?token=abc');
      expect(html).toContain('Restablecer');
      expect(text).toContain('Restablecer: https://x.test/reset?token=abc');
    });

    it('OMITE el bloque CTA cuando no hay cta (no deja el placeholder)', () => {
      const { html } = renderEmail({ title: 'Aviso', bodyHtml: '<p>x</p>' });
      expect(html).not.toContain('{{ctaBlock}}');
      expect(html).not.toContain('v:roundrect');
    });

    it('no deja placeholders sin resolver', () => {
      const { html } = renderEmail({
        title: 'T',
        bodyHtml: '<p>b</p>',
        cta: { url: 'https://x.test', label: 'Ir' },
      });
      expect(html).not.toMatch(/{{\w+}}/);
    });

    it('adapta los colores a la paleta del tema (Marquesina/claro)', () => {
      const { html } = renderEmail(
        { title: 'T', bodyHtml: '<p>b</p>' },
        EMAIL_THEMES['marquesina'],
      );
      expect(html).toContain('#f6f1e8'); // fondo claro
      expect(html).toContain('#d1521f'); // acento cálido
      expect(html).not.toContain('#0a0d13'); // NO el fondo oscuro de Pulso
    });

    it('escapa la URL/label del CTA (anti-inyección)', () => {
      const { html } = renderEmail({
        title: 'T',
        bodyHtml: '<p>b</p>',
        cta: { url: 'https://x.test/"><img>', label: '<b>hack</b>' },
      });
      expect(html).not.toContain('"><img>');
      expect(html).toContain('&lt;b&gt;hack&lt;/b&gt;');
    });
  });
});
