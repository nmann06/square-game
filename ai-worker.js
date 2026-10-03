import { parentPort, workerData } from 'node:worker_threads';
import { chooseAiTurn } from './ai.js';

parentPort.postMessage(chooseAiTurn(workerData.observation, workerData.difficulty));
