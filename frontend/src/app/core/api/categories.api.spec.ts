import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { CategoriesApi } from './categories.api';

const BASE = 'http://api.test/api/v1';

describe('CategoriesApi', () => {
  let api: CategoriesApi;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    api = TestBed.inject(CategoriesApi);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('list pega a /categories', () => {
    api.list().subscribe();
    const req = mock.expectOne(`${BASE}/categories`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getBySlug pega a /categories/:slug', () => {
    api.getBySlug('conciertos').subscribe();
    mock.expectOne(`${BASE}/categories/conciertos`).flush({});
  });
});
