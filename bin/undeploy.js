// Takes the deployed study offline and deletes everything the server keeps for it
import { ask, deployedStudy, getToken, request } from './study-deploy.js';

const { server, name } = deployedStudy();
console.log(`This takes ${name} offline and deletes all its data on ${server}.`);
const unconfirmed = 'Nothing was deleted.';
if ((await ask(`Type ${name} to confirm: `, unconfirmed)) !== name) {
  console.error(unconfirmed);
  process.exit(1);
}

const response = await request(server, `/deploy/${name}`, await getToken(server), { method: 'DELETE' });
console.log((await response.text()).trim());
if (!response.ok) process.exit(1);
console.log('If you have set up GitHub deploy for this study, run `gh secret delete DEPLOY_TOKEN` (otherwise the next push brings it back again)');
