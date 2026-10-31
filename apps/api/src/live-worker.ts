import 'dotenv/config';
import { startLiveWorker } from './live-pilot';
startLiveWorker();
console.log('Standalone live pilot worker started: maximum 2 recipients per campaign');
