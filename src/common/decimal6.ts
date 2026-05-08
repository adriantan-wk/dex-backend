import BigNumber from 'bignumber.js';
import { Types } from 'mongoose';

// Universal constant for USD decimals.
export const USD_DECIMALS_MAX = 6;

export function floorToMaxDecimals(
  input: BigNumber.Value,
  decimals: number,
): BigNumber {
  const x = new BigNumber(input);
  if (!x.isFinite() || x.isNaN()) return new BigNumber(0);
  if (decimals <= 0) return x.integerValue(BigNumber.ROUND_FLOOR);
  return x.decimalPlaces(decimals, BigNumber.ROUND_FLOOR);
}

export function floorTo6DecimalString(input: BigNumber.Value): string {
  return floorToMaxDecimals(input, USD_DECIMALS_MAX).toFixed();
}

function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  let t = s.replace(/0+$/, '');
  t = t.replace(/\.$/, '');
  return t || '0';
}

export function decimal128FromBigNumberFloor6(
  value: BigNumber,
): Types.Decimal128 {
  const floored = floorToMaxDecimals(value, USD_DECIMALS_MAX);
  if (!floored.isFinite() || floored.isNaN() || floored.isZero()) {
    return Types.Decimal128.fromString('0');
  }

  // Prefer minimal string (no padded zeros). If Mongo rejects due to significant
  // digits, fall back to a clamped precision string and trim.
  const minimal = trimTrailingZeros(floored.toFixed());
  try {
    return Types.Decimal128.fromString(minimal);
  } catch {
    // Mongo Decimal128 supports ~34 significant digits. Clamp to avoid
    // "inexact rounding" BSONError.
    const sign = floored.isNegative() ? '-' : '';
    const abs = floored.abs();
    const clamped = trimTrailingZeros(abs.toPrecision(34, BigNumber.ROUND_DOWN));
    return Types.Decimal128.fromString(`${sign}${clamped}`);
  }
}
