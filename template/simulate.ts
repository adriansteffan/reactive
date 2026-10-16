import { runSimulation } from '@adriansteffan/reactive';
import { api } from './server';

// Imported through a function, so that the simulation notices random numbers drawn while the experiment loads
await runSimulation(() => import('./src/Experiment'), api);
