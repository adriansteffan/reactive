import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = join(import.meta.dir, '..');

// Bun matches the library's sideEffects patterns only when the library is installed in a project's
// node_modules, so the build runs in such a project
test('a production build of an experiment leaves out unused components and keeps the array methods', async () => {
  const project = mkdtempSync(join(tmpdir(), 'reactive-bundle-'));
  const library = join(project, 'node_modules/@adriansteffan/reactive');
  mkdirSync(library, { recursive: true });
  cpSync(join(root, 'src'), join(library, 'src'), { recursive: true });
  cpSync(join(root, 'package.json'), join(library, 'package.json'));
  for (const dependency of ['react', 'fflate']) {
    symlinkSync(join(root, 'node_modules', dependency), join(project, 'node_modules', dependency));
  }
  const entry = join(project, 'entry.tsx');
  writeFileSync(
    entry,
    "import { defineExperiment, Text } from '@adriansteffan/reactive';\nexport default defineExperiment({ timeline: [Text.trial('intro')] });\n",
  );

  const result = await Bun.build({ entrypoints: [entry], minify: true });
  const code = await result.outputs[0].text();
  expect(code).toContain('"Text"');
  expect(code).not.toContain('RandomDotKinematogram');
  expect(code).toContain('defineProperty(Array.prototype');
});
