export function normalizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.,]/g, '');
  if (!cleaned) return '';

  const hasComma = cleaned.includes(',');
  const hasPeriod = cleaned.includes('.');
  if (hasComma && hasPeriod) {
    const decimalIndex = Math.max(
      cleaned.lastIndexOf(','),
      cleaned.lastIndexOf('.'),
    );
    const integer = cleaned.slice(0, decimalIndex).replace(/[,.]/g, '');
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[,.]/g, '');
    return `${integer}.${fraction}`;
  }

  if (hasPeriod) {
    const [integer, ...fractions] = cleaned.split('.');
    return `${integer}${fractions.length ? `.${fractions.join('')}` : '.'}`;
  }

  if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) return cleaned.replaceAll(',', '');
    const commaIndex = cleaned.indexOf(',');
    const integer = cleaned.slice(0, commaIndex).replaceAll(',', '');
    const fraction = cleaned.slice(commaIndex + 1).replaceAll(',', '');
    return `${integer}.${fraction}`;
  }

  return cleaned;
}

export function normalizeCountInput(value: string, allowFraction = false) {
  const cleaned = value.replace(/[^\d.,]/g, '');
  if (!allowFraction) {
    const separatorIndex = cleaned.search(/[.,]/);
    return (
      separatorIndex < 0 ? cleaned : cleaned.slice(0, separatorIndex)
    ).replace(/\D/g, '');
  }
  const separatorIndex = cleaned.search(/[.,]/);
  if (separatorIndex < 0) return cleaned;
  const integer = cleaned.slice(0, separatorIndex).replace(/[.,]/g, '');
  const fraction = cleaned.slice(separatorIndex + 1).replace(/[.,]/g, '');
  return `${integer}.${fraction}`;
}
