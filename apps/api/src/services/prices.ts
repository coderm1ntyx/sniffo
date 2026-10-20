import type { PriceRecord } from '@sniffo/shared';

const isoCurrencies = new Set(Intl.supportedValuesOf('currency'));
export function normalizeCurrency(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  const symbols: Record<string, string> = {
    '฿': 'THB',
    BAHT: 'THB',
    'THAI BAHT': 'THB',
    บาท: 'THB',
    US$: 'USD',
    S$: 'SGD',
    A$: 'AUD',
    CA$: 'CAD',
    HK$: 'HKD',
    NT$: 'TWD',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
    '₩': 'KRW',
    RP: 'IDR',
    RM: 'MYR',
    '₱': 'PHP',
    '₫': 'VND',
  };
  return symbols[key] ?? (isoCurrencies.has(key) ? key : null);
}

export function findBahtCurrencyEvidence(text: string) {
  const match = /฿|thai\s+baht|\bbaht\b|บาท/i.exec(text);
  return match ? { currency: 'THB', quote: match[0] } : null;
}

/** A lone separator followed by three digits is a grouping separator. */
export function parseLocalizedAmount(raw: string): number | null {
  let value = raw.trim().replace(/[ \u00a0\u202f']/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return null;
  const decimal = value.match(/[.,](\d{1,2})$/);
  if (decimal) {
    const split = value.length - decimal[0].length;
    value = value.slice(0, split).replace(/[.,]/g, '') + '.' + decimal[1];
  } else value = value.replace(/[.,]/g, '');
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
const currency =
  '(?:Thai\\s+Baht|US\\$|S\\$|A\\$|CA\\$|HK\\$|NT\\$|' +
  [...isoCurrencies].join('|') +
  '|baht|บาท|Rp|RM|[฿$€£¥₹₩₱₫])';
const amount = "\\d+(?:[., \\u00a0\\u202f']\\d+)*";

/** Classify only local, explicit context; never assume a billing period from rent. */
export function extractPrices(
  text: string,
): Array<{ price: PriceRecord; quote: string }> {
  const result: Array<{ price: PriceRecord; quote: string }> = [];
  for (const line of text.split('\n')) {
    const pattern = new RegExp(
      `(${currency})\\s*(${amount})|(${amount})\\s*(${currency})|((?:monthly\\s+)?rent|price|deposit|มัดจำ)\\s*[:=]?\\s*(${amount})`,
      'gi',
    );
    const matches = [...line.matchAll(pattern)];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const start = match.index!;
      const previous = matches[i - 1];
      const before = line
        .slice(previous ? previous.index! + previous[0].length : 0, start)
        .replace(
          previous
            ? /^\s*(?:(?:\/|per\s+)(?:month|mo|night|week)|for\s+\d+\s+nights?)\b/i
            : /$^/,
          '',
        )
        .split(/[,;]|\s{2,}/)
        .at(-1)!;
      const after = line.slice(
        start + match[0].length,
        matches[i + 1]?.index ?? line.length,
      );
      const prefix = `${before}${match[5] ?? ''}`;
      // Do not let a label for the next amount classify the preceding one.
      const suffix = after.split(
        /[,;]|(?:monthly\s+rent|rent\s*:|deposit|cleaning|service|มัดจำ)/i,
      )[0]!;
      const context = prefix + ' ' + suffix;
      let basis: PriceRecord['basis'] = 'unknown';
      if (/deposit|มัดจำ/i.test(prefix)) basis = 'deposit';
      else if (/cleaning\s+fee/i.test(prefix)) basis = 'cleaning_fee';
      else if (/service\s+fee|admin(?:istration)?\s+fee/i.test(prefix))
        basis = 'service_fee';
      else if (
        /(?:reservation|booking|holding|application)\s+fee/i.test(prefix)
      )
        basis = 'other_fee';
      else if (/fee\s*[:=]?\s*$/i.test(prefix)) basis = 'other_fee';
      else if (/tax(?:es)?|additional guest (?:fee|charge)/i.test(prefix))
        basis = 'other_fee';
      else if (
        /for\s+\d+\s+nights?|total.*\d+\s+nights?|\d+\s+(?:nights?|nuit(?:s|ées)?|noches|nächte|ноч(?:ь|и|ей)|คืน)/i.test(
          context,
        )
      )
        basis = 'stay_total';
      else if (
        /monthly(?!\s+(?:discount|savings?|promotion|offer))|per\s+month|\/\s*(?:month|mo)\b|\/\s*เดือน|por\s+mes|par\s+mois|pro\s+monat|\bmes(?:ual)?\b/i.test(
          context,
        )
      )
        basis = 'monthly_rent';
      else if (
        /nightly|per\s+night|\/\s*night\b|par\s+nuit|por\s+noche|pro\s+nacht|คืนละ/i.test(
          context,
        )
      )
        basis = 'nightly_rate';
      else if (
        /weekly(?!\s+(?:discount|savings?|promotion|offer))|per\s+week|\/\s*week\b|par\s+semaine|por\s+semana|pro\s+woche/i.test(
          context,
        )
      )
        basis = 'weekly_rate';
      if (
        basis === 'monthly_rent' &&
        /per\s+night|\/\s*night\b|per\s+week|\/\s*week\b/i.test(context)
      )
        basis = 'unknown';
      const rawCurrency =
        match[1] ??
        match[4] ??
        (match[5]
          ? after.match(new RegExp(`^\\s*(${currency})`, 'i'))?.[1]
          : null) ??
        null;
      if (rawCurrency && /^(all|try|mad|cop|pen|top|gel)$/.test(rawCurrency))
        continue;
      const explicitCode =
        after.match(/^\s*(USD|SGD|AUD|CAD|JPY|CNY|HKD|TWD)\b/)?.[1] ??
        before.match(/\b(USD|SGD|AUD|CAD|JPY|CNY|HKD|TWD)\s*$/)?.[1];
      const quote = line
        .slice(start - before.length, start + match[0].length + suffix.length)
        .trim();
      const nights = context.match(
        /(?:for\s+)?(\d+)\s+(?:nights?|nuit(?:s|ées)?|noches|nächte|ноч(?:ь|и|ей)|คืน)/i,
      );
      result.push({
        quote,
        price: {
          amount: parseLocalizedAmount((match[2] ?? match[3] ?? match[6])!)!,
          currency:
            (rawCurrency ? normalizeCurrency(rawCurrency) : null) ??
            (explicitCode ? normalizeCurrency(explicitCode) : null),
          rawCurrency,
          rawText: match[0],
          basis,
          basisExplicit: basis !== 'unknown',
          ...(nights ? { nights: Number(nights[1]) } : {}),
        },
      });
    }
  }
  return result;
}
