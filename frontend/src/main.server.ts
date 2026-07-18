import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

// Angular 20.3+ exige propagar el BootstrapContext al bootstrap de servidor; sin él,
// la extracción de rutas / SSR lanza NG0401 (Missing Platform).
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
