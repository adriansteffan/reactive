// Builds the study in the current directory and uploads it to a study-deploy server
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import { spawnSync } from 'child_process';
import { zipSync } from 'fflate';
import { ask, getToken, readProject, request } from './study-deploy.js';

const project = readProject();
const notSetUp = 'package.json does not say where to deploy. Run `bun run deploy` in a terminal once, and it asks.';
const address = project.studyDeploy?.server ?? (await ask('Server (e.g. https://deploy.exp.example.org): ', notSetUp));
const url = address.includes('://') ? address : `https://${address}`;
if (!URL.canParse(url)) {
  console.error(`${address} is not a valid address.`);
  process.exit(1);
}
const server = new URL(url).origin;
const name = project.studyDeploy?.name ?? (await ask('Subdomain for the study: ', notSetUp));

const token = await getToken(server);

const build = spawnSync('bun', ['run', 'build:production'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

// The server's files at the top level, and public/ next to them
const files = {};
for (const [dir, prefix] of [['dist/server', ''], ['public', 'public/']]) {
  for (const file of readdirSync(dir, { recursive: true })) {
    const source = join(dir, file);
    if (statSync(source).isFile()) files[prefix + file.split(sep).join('/')] = readFileSync(source);
  }
}

if (existsSync('.env.production')) files['.env'] = readFileSync('.env.production');
else console.log('There is no .env.production, so the study is deployed without any settings or keys.');

const response = await request(server, `/deploy/${name}`, token, { method: 'POST', body: zipSync(files) });
console.log((await response.text()).trim());

if (response.ok || response.status === 409 || response.status === 500) {
  if (project.studyDeploy?.server !== server || project.studyDeploy?.name !== name) {
    project.studyDeploy = { server, name };
    writeFileSync('package.json', `${JSON.stringify(project, null, 2)}\n`);
    console.log('Saved the server and subdomain in package.json.');
  }
}
if (!response.ok) process.exit(1);
