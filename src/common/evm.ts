import { isAddress } from 'viem';

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function normalizeTxHash(txHash: string): string {
  return txHash.trim().toLowerCase();
}

export function isEvmAddress(address: string): boolean {
  return isAddress(address, { strict: false });
}

