import { configuration } from './configuration';

describe('configuration()', () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
  });

  afterAll(() => {
    process.env = OLD;
  });

  it('mapea el entorno de desarrollo con flags correctos', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '8080';
    process.env.DATABASE_URL = 'postgresql://u:p@db:5432/x?schema=public';
    process.env.REDIS_URL = 'redis://r:6379';
    process.env.AMQP_URL = 'amqp://a:5672';
    process.env.CORS_ORIGINS = 'http://localhost:4200, http://localhost:4201';

    const c = configuration();

    expect(c.isDev).toBe(true);
    expect(c.isProd).toBe(false);
    expect(c.isTest).toBe(false);
    expect(c.port).toBe(8080);
    expect(c.database.url).toContain('postgresql://');
    expect(c.cors.origins).toEqual(['http://localhost:4200', 'http://localhost:4201']);
  });

  it('interpreta banderas booleanas de storage y detecta prod', () => {
    process.env.NODE_ENV = 'production';
    process.env.S3_FORCE_PATH_STYLE = 'false';
    const c = configuration();
    expect(c.isProd).toBe(true);
    expect(c.storage.s3.forcePathStyle).toBe(false);
  });

  it('usa valores por defecto cuando faltan variables opcionales', () => {
    delete process.env.PORT;
    delete process.env.APP_NAME;
    const c = configuration();
    expect(c.port).toBe(8080);
    expect(c.appName).toBe('PasaEventos');
  });
});
