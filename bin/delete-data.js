// Deletes the data the server has saved for the deployed study, which stays online
import { ask, deployedStudy, getToken, request } from './study-deploy.js';

const { server, name } = deployedStudy();
console.log(`This deletes all data of ${name} on ${server} and restarts the study.`);
const unconfirmed = 'Nothing was deleted.';
if ((await ask(`Type ${name} to confirm: `, unconfirmed)) !== name) {
  console.error(unconfirmed);
  process.exit(1);
}

const response = await request(server, `/data/${name}`, await getToken(server), { method: 'DELETE' });
console.log((await response.text()).trim() || `The server answered with status ${response.status}`);
if (!response.ok) process.exit(1);
