import type { MonitoringConfig } from './monitoring.config';

export const monitoringSettings: MonitoringConfig = {
  chainId: 56,
  pollMs: 10_000,
  reorgSafetyBlocks: 5,
  batchBlocks: 2_000,
  addressChunk: 50,
  startBlock: null,
  rpcUrl: 'https://bsc-mainnet.infura.io/v3/46d0769481924736aad53b83f2864569',
};