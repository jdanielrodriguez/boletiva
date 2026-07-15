import { Injectable } from '@nestjs/common';
import { BannerImage, BannerPrompt, BannerProvider, BannerTemplate } from '../banner.provider';

/** Escapa texto para insertarlo seguro en XML/SVG. */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Paleta (3 paradas del gradiente) por plantilla; `aurora` es la de marca. */
const PALETTES: Record<BannerTemplate, [string, string, string]> = {
  aurora: ['#7c3aed', '#db2777', '#f59e0b'],
  midnight: ['#0f172a', '#1e3a8a', '#0ea5e9'],
  sunset: ['#7c2d12', '#ea580c', '#facc15'],
  forest: ['#064e3b', '#059669', '#a3e635'],
  mono: ['#111827', '#374151', '#9ca3af'],
};

/** Parte un título largo en hasta 2 líneas para que quepa en el banner. */
function wrap(name: string, max = 22): string[] {
  const words = name.split(/\s+/);
  const lines: string[] = [''];
  for (const w of words) {
    const line = lines[lines.length - 1];
    if ((line + ' ' + w).trim().length > max && line) lines.push(w);
    else lines[lines.length - 1] = (line + ' ' + w).trim();
  }
  return lines.slice(0, 2);
}

/**
 * Generador de banners STUB: compone un SVG con la paleta de marca (gradiente
 * "pasa") y el nombre/categoría del evento. Determinista, sin dependencias ni red
 * → ideal para dev y E2E. El proveedor real (Gemini) se enchufa detrás del puerto.
 */
@Injectable()
export class StubBannerProvider implements BannerProvider {
  readonly name = 'stub';

  async generate(prompt: BannerPrompt): Promise<BannerImage> {
    const lines = wrap(prompt.eventName || 'Evento');
    const cat = prompt.categoryName ? xml(prompt.categoryName.toUpperCase()) : 'BOLETIVA';
    const [c0, c1, c2] = PALETTES[prompt.template ?? 'aurora'] ?? PALETTES.aurora;
    const titleSpans = lines
      .map((l, i) => `<tspan x="600" dy="${i === 0 ? 0 : 72}">${xml(l)}</tspan>`)
      .join('');
    // El prompt del promotor se refleja como tagline (recortado) → el stub "usa" la
    // instrucción de forma visible; el proveedor real la interpreta con IA.
    const tagline = prompt.prompt
      ? xml(prompt.prompt.trim().slice(0, 60))
      : 'boletiva';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="0.55" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="628" fill="#0b0b12"/>
  <rect width="1200" height="628" fill="url(#g)" opacity="0.92"/>
  <text x="600" y="120" fill="#ffffff" opacity="0.85" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="4" text-anchor="middle">${cat}</text>
  <text x="600" y="330" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="800" text-anchor="middle">${titleSpans}</text>
  <text x="600" y="560" fill="#ffffff" opacity="0.9" font-family="Arial, sans-serif" font-size="26" font-weight="600" text-anchor="middle">${tagline}</text>
</svg>`;
    return { body: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml', ext: 'svg' };
  }
}
