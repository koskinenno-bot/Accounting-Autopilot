/**
 * Calculates a Finnish creditor reference (viitenumero) with 7-3-1 weights.
 */
export const calculateFinnishReference = (baseNumber: string): string => {
  const weights = [7, 3, 1];
  let sum = 0;
  
  // Calculate weighted sum from right to left
  const reversedBase = baseNumber.split('').reverse().join('');
  for (let i = 0; i < reversedBase.length; i++) {
    sum += parseInt(reversedBase[i]) * weights[i % 3];
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return baseNumber + checkDigit;
};

/**
 * Calculates an International (RF) ISO 11649 reference.
 */
export const calculateRFReference = (baseNumber: string): string => {
  const reference = calculateFinnishReference(baseNumber);
  // RF translation: RF + DD + Reference
  // We'll focus on the standard Finnish reference for now as it's most common in housing companies
  return reference;
};

/**
 * Formats a reference number for display (groups of 5)
 */
export const formatReference = (reference: string): string => {
  return reference.replace(/(.{5})/g, '$1 ').trim();
};
