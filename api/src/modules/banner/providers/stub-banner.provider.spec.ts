import { StubBannerProvider } from './stub-banner.provider';

describe('StubBannerProvider', () => {
  const provider = new StubBannerProvider();

  it('genera un SVG con el nombre y la categoría del evento', async () => {
    const img = await provider.generate({ eventName: 'Concierto Rock', categoryName: 'Conciertos' });
    const svg = img.body.toString('utf8');
    expect(img.contentType).toBe('image/svg+xml');
    expect(img.ext).toBe('svg');
    expect(svg).toContain('<svg');
    expect(svg).toContain('Concierto Rock');
    expect(svg).toContain('CONCIERTOS');
  });

  it('escapa caracteres peligrosos del nombre (anti-inyección XML)', async () => {
    const img = await provider.generate({ eventName: 'Rock & <b>Pop</b>' });
    const svg = img.body.toString('utf8');
    expect(svg).toContain('Rock &amp;');
    expect(svg).not.toContain('<b>Pop</b>');
  });

  it('usa un título por defecto si el nombre viene vacío', async () => {
    const img = await provider.generate({ eventName: '' });
    expect(img.body.toString('utf8')).toContain('Evento');
  });
});
