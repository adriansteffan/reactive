// Takes the deployed study offline and deletes everything the server keeps for it
import { ask, deployedStudy, getToken, request } from './study-deploy.js';

const { server, name } = deployedStudy();
console.log(`This takes ${name} offline and deletes all its data on ${server}. Run \`bun run download\` first if you still need it.`);
const unconfirmed = 'Nothing was deleted.';
if ((await ask(`Type ${name} to confirm: `, unconfirmed)) !== name) {
  console.error(unconfirmed);
  process.exit(1);
}

const response = await request(server, `/deploy/${name}`, await getToken(server), { method: 'DELETE' });
console.log((await response.text()).trim());
if (!response.ok) process.exit(1);
console.log('If GitHub deploys this study, run `gh secret delete DEPLOY_TOKEN`, or the next push brings it back.');
