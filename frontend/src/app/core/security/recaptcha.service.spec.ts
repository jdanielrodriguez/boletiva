import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicConfigStore } from '../config/public-config.store';
import { RecaptchaService } from './recaptcha.service';

/** Store falso con una site key controlable. */
function fakeStore(siteKey: string) {
  const key = signal(siteKey);
  return { recaptchaSiteKey: key.asReadonly() } as unknown as PublicConfigStore;
}

function build(siteKey: string, platform: 'browser' | 'server'): RecaptchaService {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      RecaptchaService,
      { provide: PublicConfigStore, useValue: fakeStore(siteKey) },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return TestBed.inject(RecaptchaService);
}

describe('RecaptchaService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sin site key → execute resuelve "" (no bloquea, no carga script)', async () => {
    const svc = build('', 'browser');
    await expectAsync(svc.execute('login')).toBeResolvedTo('');
  });

  it('con site key pero SSR (no browser) → execute "" sin romper (no toca el DOM)', async () => {
    const svc = build('pub-key', 'server');
    await expectAsync(svc.execute('signup')).toBeResolvedTo('');
  });
});
