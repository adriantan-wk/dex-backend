import { getAddress } from 'viem';

/**
 * Hardcoded allowlist of admin wallets.
 *
 * Use checksummed addresses. `getAddress()` normalizes/validates the checksum
 * at module load time so typos fail fast.
 */
export const ADMIN_WALLETS = new Set<string>([
  getAddress('0x5379c526Aa91005321d3Bd9016b1895002d6c9e3'),
]);

export function isAdminWallet(address: string): boolean {
  try {
    return ADMIN_WALLETS.has(getAddress(address as `0x${string}`));
  } catch {
    return false;
  }
}
