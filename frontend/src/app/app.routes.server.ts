import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // SSR bajo demanda (no prerender): las páginas piden datos al API en cada
    // request. Prerender en build pegaría al API antes de que exista.
    path: '**',
    renderMode: RenderMode.Server,
  },
];
