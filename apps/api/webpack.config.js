const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        // Migrator and SQL migrations ship with the image (ADR-0006): run by the compose `migrate` service.
        { input: './scripts', glob: 'migrate.mjs', output: 'scripts' },
        { input: './migrations', glob: '*.sql', output: 'migrations' },
        // Issues the one-time activation code of an owner (auth design 2026-10-02, section 6): in test/prod
        // PostgreSQL is reachable only inside the compose network, so the operator runs it from the image.
        { input: './scripts', glob: 'create-activation-code.mjs', output: 'scripts' },
        // Creates a platform operator and issues his one-time activation code (auth design, section 9).
        { input: './scripts', glob: 'create-operator.mjs', output: 'scripts' },
        // Generates the JWT key and pepper of an offline store into its env file (auth design, section 10).
        { input: './scripts', glob: 'generate-store-secrets.mjs', output: 'scripts' },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
