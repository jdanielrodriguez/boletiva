export default {
  displayName: 'api',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../coverage/api',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.e2e-spec.ts'],
  testTimeout: 30000,
  // Los tests e2e comparten UNA base Postgres/Redis real: ejecutarlos en paralelo
  // provoca contención del pool de conexiones y races de teardown (flakiness).
  // Serial (1 worker) es la opción determinista para tests de integración.
  maxWorkers: 1,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{js,ts}',
    '!<rootDir>/src/main.ts',
    '!<rootDir>/src/**/*.module.ts',
    '!<rootDir>/src/**/*.spec.ts',
  ],
  coveragePathIgnorePatterns: ['<rootDir>/../node_modules/', '<rootDir>/dist/'],
};
