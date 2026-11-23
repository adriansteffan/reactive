// Downloads the data of the deployed study into data_download
import { spawn } from 'child_process';
import { once } from 'events';
import { mkdirSync } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { deployedStudy, getToken, request } from './study-deploy.js';

const { server, name } = deployedStudy();
const response = await request(server, `/data/${name}`, await getToken(server));
if (!response.ok) {
  console.error((await response.text()).trim() || `The server answered with status ${response.status}`);
  process.exit(1);
}

const folder = 'data_download';
mkdirSync(folder, { recursive: true });
const tar = spawn('tar', ['-xf', '-', '-C', folder], { stdio: ['pipe', 'inherit', 'inherit'] });
const closed = once(tar, 'close');
try {
  await pipeline(Readable.fromWeb(response.body), tar.stdin);
  const [code] = await closed;
  if (code !== 0) throw new Error(`tar exited with code ${code}`);
} catch (error) {
  console.error(`The download is incomplete: ${error.message}`);
  process.exit(1);
}
console.log(`Saved the data in ${folder}/`);
