import { registerAs } from '@nestjs/config';
import { monitoringSettings } from './monitoring.settings';

export type MonitoringConfig = {
  chainId: number;
  pollMs: number;
  reorgSafetyBlocks: number;
  batchBlocks: number;
  addressChunk: number;
  startBlock: number | null;
  rpcUrl: string;
};

export default registerAs('monitoring', (): MonitoringConfig => {
  // Repo-managed config file (TypeScript), not .env and not JSON.
  // Keep this function so ConfigModule can cache/merge configs normally.
  return {
    ...monitoringSettings,
    rpcUrl: monitoringSettings.rpcUrl.trim(),
  };
});
