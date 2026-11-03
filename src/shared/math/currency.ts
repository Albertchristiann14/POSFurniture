/**
 * Currency and Integer Math Utilities for Krevia POS
 * Rule: All monetary calculations in server are pure integer (satuan Rupiah), NEVER float.
 */

/**
 * Pembagian integer dengan aturan Round Half-Up (0.5 dibulatkan ke atas).
 * Menghindari konversi float JavaScript yang berpotensi kehilangan presisi.
 */
export function roundDivBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Penyebut tidak boleh 0 (Division by zero)");
  }
  if (numerator === 0n) return 0n;

  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  // Round half-up: (absNum + absDen / 2) / absDen
  const quotient = (absNum + absDen / 2n) / absDen;
  return isNegative ? -quotient : quotient;
}

/**
 * Format BigInt Rupiah ke format string tampilan: Rp 1.500.000
 */
export function formatRupiah(amount: bigint | number): string {
  const num = typeof amount === "bigint" ? amount.toString() : Math.round(amount).toString();
  return "Rp " + num.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Parsing string angka / nominal input menjadi BigInt aman
 */
export function parseRupiah(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nilai nominal tidak valid");
    return BigInt(Math.round(value));
  }
  const clean = value.replace(/[^0-9-]/g, "");
  if (!clean || clean === "-") return 0n;
  return BigInt(clean);
}

/**
 * JSON Replacer untuk serialisasi BigInt ke string agar tidak error pada JSON.stringify
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
