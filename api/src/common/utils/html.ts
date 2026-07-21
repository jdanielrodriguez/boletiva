/** Escapa texto para interpolarlo con seguridad en HTML (correos, plantillas). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Etiquetas permitidas en el HTML enriquecido del KB (editor de formato, T6). */
const KB_ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'a', 'hr',
]);

/**
 * Sanea HTML enriquecido a un subconjunto SEGURO (whitelist) para almacenarlo (T6 KB).
 * Elimina `<script>/<style>` con su contenido, toda etiqueta fuera de la whitelist
 * (conservando su texto), y TODOS los atributos salvo `href` en `<a>` (solo
 * http/https/mailto; se le fuerza rel/target). Defensa en profundidad: el frontend
 * además sanitiza al renderizar con `[innerHTML]`. No pretende cubrir todo vector
 * exótico — el autor es admin/asesor y el render también sanea.
 */
export function sanitizeRichHtml(input: string): string {
  if (!input) return '';
  let html = input;
  // 1) Fuera bloques peligrosos con su contenido.
  html = html.replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // 2) Procesa cada etiqueta: descarta las no permitidas (deja el texto) y limpia atributos.
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!KB_ALLOWED_TAGS.has(name)) return '';
    const isClose = /^<\//.test(tag);
    if (isClose) return `</${name}>`;
    const selfClose = name === 'br' || name === 'hr';
    if (name === 'a' && !isClose) {
      const hrefMatch = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? '').trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        return `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">`;
      }
      return '<a>';
    }
    return selfClose ? `<${name}>` : `<${name}>`;
  });
  return html.trim();
}

/** Convierte HTML a texto plano (para búsqueda y JSON-LD `acceptedAnswer`). */
export function stripHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
