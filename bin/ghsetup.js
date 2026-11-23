// Saves the token and .env.production as secrets of the study's GitHub repository, for .github/workflows/deploy.yml
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { deployedStudy, tokens } from './study-deploy.js';

const token = process.env.DEPLOY_TOKEN || tokens[deployedStudy().server];
if (!token) {
  console.error('Run `bun run deploy` first, which asks for your token.');
  process.exit(1);
}

function setSecret(name, value) {
  const result = spawnSync('gh', ['secret', 'set', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) console.error('This needs the GitHub CLI, see https://cli.github.com.');
  if (result.status !== 0) process.exit(1);
}

setSecret('DEPLOY_TOKEN', token);
if (existsSync('.env.production')) setSecret('DOTENV', readFileSync('.env.production'));
console.log('GitHub now deploys on every push to main. Commit package.json first if you have not.');
