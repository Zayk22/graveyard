/**
 * Formats an integer kobo value as a naira string.
 *
 * @param kobo - Integer number of kobo (100 kobo = 1 naira). Never a float.
 * @returns A string in the form "NGN X,XXX.XX" with comma digit-group separators
 *          and exactly two decimal places.
 *
 * Examples:
 *   formatNaira(0)       → "NGN 0.00"
 *   formatNaira(150000)  → "NGN 1,500.00"
 *   formatNaira(123456)  → "NGN 1,234.56"
 */
export function formatNaira(kobo: number): string {
  const naira = Math.floor(kobo / 100);
  const koboPart = kobo % 100;

  // Format naira with comma thousands separators
  const nairaStr = naira.toLocaleString("en-US");

  // Pad kobo to two digits
  const koboStr = koboPart.toString().padStart(2, "0");

  return `NGN ${nairaStr}.${koboStr}`;
}
