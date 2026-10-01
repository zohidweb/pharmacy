const nextJest = require('next/jest.js');

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  displayName: 'admin',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/admin',
  testEnvironment: 'jsdom',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFilesAfterEnv: ['<rootDir>/specs/setup.ts'],
};

const jestConfig = createJestConfig(config);

module.exports = async () => {
  const resolved = await jestConfig();
  // Disable SWC path alias resolution — handled by Nx jest resolver.
  for (const value of Object.values(resolved.transform)) {
    if (Array.isArray(value) && value[1]?.resolvedBaseUrl) {
      value[1] = { ...value[1], resolvedBaseUrl: undefined };
    }
  }
  // use-intl and its ICU dependencies ship ESM only: let SWC transform them.
  resolved.transformIgnorePatterns = [
    '/node_modules/(?!(use-intl|icu-minify|intl-messageformat|@formatjs|@schummar|uuid)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ];
  return resolved;
};
