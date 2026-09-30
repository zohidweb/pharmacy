/**
 * @jest-environment node
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
// eslint-disable-next-line @nx/enforce-module-boundaries -- tests the workspace FSD rules this app's eslint.config.mjs loads
import { fsdLayerRules } from '../../../tools/eslint-rules/fsd-layers.mjs';

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
  ...fsdLayerRules(),
];

function restrictedImports(filename: string, code: string): string[] {
  const messages = linter.verify(code, config, filename);
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

describe('FSD ESLint layer rules (ADR-0017)', () => {
  it('rejects an import from a higher layer', () => {
    expect(
      restrictedImports(
        'src/features/probe/index.ts',
        "import { HomePage } from '@/pages/home';",
      ),
    ).toEqual([
      expect.stringContaining('must not import from higher layer "pages"'),
    ]);
  });

  it('rejects a deep import into a slice', () => {
    expect(
      restrictedImports(
        'src/app/index.ts',
        "import { HomePage } from '@/pages/home/ui/HomePage';",
      ),
    ).toEqual([
      expect.stringContaining('import a slice only through its public API'),
    ]);
  });

  it('allows an entities cross-import through @x', () => {
    expect(
      restrictedImports(
        'src/entities/receipt/model/types.ts',
        "import type { Batch } from '@/entities/batch/@x/receipt';",
      ),
    ).toEqual([]);
  });
});
