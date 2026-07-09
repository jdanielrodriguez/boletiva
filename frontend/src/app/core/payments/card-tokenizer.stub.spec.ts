import { CardTokenizerStub } from './card-tokenizer.stub';

describe('CardTokenizerStub (tokenización PCI en cliente)', () => {
  const t = new CardTokenizerStub();
  const base = { expMonth: '12', expYear: '28', cvc: '123' };

  it('detecta Visa y devuelve nonce + últimos 4 (sin exponer el PAN)', () => {
    const r = t.tokenize({ ...base, number: '4242 4242 4242 4242' });
    expect(r.brand).toBe('visa');
    expect(r.last4).toBe('4242');
    expect(r.nonce).toMatch(/^nonce_[a-f0-9]+$/);
    expect(r.nonce).not.toContain('4242424242424242');
  });

  it('detecta Mastercard, Amex, Discover y otras', () => {
    expect(t.tokenize({ ...base, number: '5555555555554444' }).brand).toBe('mastercard');
    expect(t.tokenize({ ...base, number: '2223003122003222' }).brand).toBe('mastercard');
    expect(t.tokenize({ ...base, number: '378282246310005', cvc: '1234' }).brand).toBe('amex');
    expect(t.tokenize({ ...base, number: '6011111111111117' }).brand).toBe('discover');
    expect(t.tokenize({ ...base, number: '7011111111111117' }).brand).toBe('other');
  });

  it('rechaza un número demasiado corto o largo', () => {
    expect(() => t.tokenize({ ...base, number: '123' })).toThrowError(/inválido/);
    expect(() => t.tokenize({ ...base, number: '1'.repeat(20) })).toThrowError(/inválido/);
  });

  it('rechaza un CVC inválido', () => {
    expect(() => t.tokenize({ ...base, number: '4242424242424242', cvc: 'ab' })).toThrowError(/CVC/);
  });

  it('genera nonces distintos en llamadas sucesivas', () => {
    const a = t.tokenize({ ...base, number: '4242424242424242' });
    const b = t.tokenize({ ...base, number: '4242424242424242' });
    expect(a.nonce).not.toBe(b.nonce);
  });
});
