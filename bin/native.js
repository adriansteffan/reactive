// Adds Android and iOS support to the experiment project in the current directory
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const projectPath = process.cwd();
const projectPackagePath = join(projectPath, 'package.json');

if (!existsSync(projectPackagePath)) {
  console.error('Run this command in the root directory of your experiment project.');
  process.exit(1);
}

const project = JSON.parse(readFileSync(projectPackagePath, 'utf8'));
const library = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
);

function run(args) {
  console.log(`> bun ${args.join(' ')}`);
  const result = spawnSync('bun', args, { cwd: projectPath, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// At the versions the library declares as its peer dependencies
const peers = library.peerDependencies;
const capacitorVersion = peers['@capacitor/core'];
const nativePlugins = ['@capacitor/core', '@capacitor/filesystem', '@capacitor/status-bar', '@adriansteffan/immersive-mode'].map(
  (name) => `${name}@${peers[name]}`,
);

run(['add', ...nativePlugins, `@capacitor/android@${capacitorVersion}`, `@capacitor/ios@${capacitorVersion}`]);
run(['add', '--dev', `@capacitor/cli@${capacitorVersion}`]);

const configPath = join(projectPath, 'capacitor.config.ts');
if (!existsSync(configPath)) {
  const appId = `com.${project.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.app`;
  writeFileSync(
    configPath,
    `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${appId}',
  appName: '${project.name}',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*'],
  },
};

export default config;
`,
  );
  console.log('Created capacitor.config.ts');
}

const mainPath = join(projectPath, 'src', 'main.tsx');
const mainSource = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : null;
if (mainSource === null) {
  console.log('Could not find src/main.tsx. Add this line to your entry file:\n    import "@adriansteffan/reactive/native";');
} else if (!mainSource.includes('@adriansteffan/reactive/native')) {
  const lines = mainSource.split('\n');
  const lastImport = lines.findLastIndex((line) => line.startsWith('import '));
  lines.splice(lastImport + 1, 0, 'import "@adriansteffan/reactive/native";');
  writeFileSync(mainPath, lines.join('\n'));
  console.log('Added the native integration to src/main.tsx');
}

console.log(`
Android and iOS support added. Create the native projects with

    bunx cap add android
    bunx cap add ios

and see "Android and iOS apps" in the reactive README for the remaining setup:
https://github.com/adriansteffan/reactive#android-and-ios-apps
`);
