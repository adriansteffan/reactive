// Shared by the commands that talk to a study-deploy server
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { createInterface } from 'readline/promises';

const tokensPath = join(homedir(), '.config', 'study-deploy', 'tokens.json');
export const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, 'utf8')) : {};

export function readProject() {
  if (!existsSync('package.json')) {
    console.error('Run this command in the root directory of your experiment project.');
    process.exit(1);
  }
  return JSON.parse(readFileSync('package.json', 'utf8'));
}

export function deployedStudy() {
  const { studyDeploy } = readProject();
  if (!studyDeploy) {
    console.error('This study has not been deployed with `bun run deploy` yet.');
    process.exit(1);
  }
  return studyDeploy;
}

export async function ask(question, missing) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = process.stdin.isTTY ? (await rl.question(question)).trim() : '';
  rl.close();
  if (!answer) {
    console.error(missing);
    process.exit(1);
  }
  return answer;
}

export async function getToken(server) {
  return process.env.DEPLOY_TOKEN || tokens[server] || (await ask(`Your token for ${server}: `, 'Set DEPLOY_TOKEN.'));
}

export async function request(server, path, token, options) {
  let response;
  try {
    response = await fetch(server + path, { ...options, headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    console.error(`Could not reach ${server} (${error.cause?.code ?? error.message})`);
    process.exit(1);
  }
  if (!process.env.DEPLOY_TOKEN) {
    if (response.status === 401) delete tokens[server];
    else tokens[server] = token;
    mkdirSync(dirname(tokensPath), { recursive: true });
    writeFileSync(tokensPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  }
  return response;
}
