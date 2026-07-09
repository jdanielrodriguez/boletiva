import { StubCardTokenizer } from './card-tokenizer';

/**
 * Tokenizador stub: intercambia un nonce por un token opaco. Cubre el camino feliz
 * y la rama defensiva de nonce vacío (que el DTO ya bloquea, pero el puerto valida).
 */
describe('StubCardTokenizer', () => {
  const tokenizer = new StubCardTokenizer();

  it('devuelve un token opaco con prefijo tok_ para un nonce válido', async () => {
    const { token } = await tokenizer.tokenize('nonce-abc');
    expect(token).toMatch(/^tok_[a-f0-9]{36}$/);
  });

  it('dos nonces producen tokens distintos (aleatorios, no derivados del PAN)', async () => {
    const a = await tokenizer.tokenize('n1');
    const b = await tokenizer.tokenize('n1');
    expect(a.token).not.toBe(b.token);
  });

  it('rechaza un nonce vacío o en blanco', async () => {
    await expect(tokenizer.tokenize('')).rejects.toThrow('nonce');
    await expect(tokenizer.tokenize('   ')).rejects.toThrow('nonce');
  });
});
