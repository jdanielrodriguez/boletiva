/** Genera un slug URL-safe a partir de un texto (sin acentos, kebab-case). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // quita acentos (marcas diacríticas combinantes)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Añade un sufijo corto para desambiguar slugs colisionados. */
export function slugWithSuffix(text: string, suffix: string): string {
  return `${slugify(text)}-${suffix}`.slice(0, 90);
}
