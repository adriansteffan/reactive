// Adds extras to the experiment project in the current directory, e.g. `add quest tutorial`
import { cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

// Extra components and the packages they need
const components = {
  quest: ['survey-core', 'survey-react-ui'],
  tutorial: ['motion'],
};
const extras = [...Object.keys(components), 'transcription'];

const projectPath = process.cwd();
const projectPackagePath = join(projectPath, 'package.json');
if (!existsSync(projectPackagePath)) {
  console.error('Run this command in the root directory of your experiment project.');
  process.exit(1);
}

const names = process.argv.slice(3);
if (names.length === 0 || names.some((name) => !extras.includes(name))) {
  console.error(`Usage: bunx @adriansteffan/reactive add <${extras.join('|')}> ...`);
  process.exit(1);
}

const libraryPath = join(dirname(fileURLToPath(import.meta.url)), '..');

const added = names.filter((name) => name in components);
if (added.length > 0) {
  // At the versions the library declares as its peer dependencies
  const peers = JSON.parse(readFileSync(join(libraryPath, 'package.json'), 'utf8')).peerDependencies;
  const packages = added.flatMap((name) => components[name]).map((name) => `${name}@${peers[name]}`);
  console.log(`> bun add ${packages.join(' ')}`);
  const result = spawnSync('bun', ['add', ...packages], { cwd: projectPath, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`\nImport them from ${added.map((name) => `@adriansteffan/reactive/${name}`).join(' and ')}.`);
}

if (names.includes('transcription')) {
  const target = join(projectPath, 'transcription');
  if (existsSync(target)) {
    console.log('transcription/ already exists and was left as it is.');
  } else {
    cpSync(join(libraryPath, 'extras', 'transcription'), target, { recursive: true });
  }
  // Read after `bun add`, which changes package.json too
  const project = JSON.parse(readFileSync(projectPackagePath, 'utf8'));
  project.scripts = {
    ...project.scripts,
    transcribe: 'docker compose -f transcription/compose.yaml run --rm transcribe',
    'transcribe:gpu': 'docker compose -f transcription/compose.yaml run --rm transcribe-gpu',
  };
  writeFileSync(projectPackagePath, `${JSON.stringify(project, null, 2)}\n`);
  console.log('\nAdded transcription/ and the scripts transcribe and transcribe:gpu, see "Transcription" in README.md.');
}
