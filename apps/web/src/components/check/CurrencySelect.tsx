import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

const currencyCodes =
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL`.split(
    ' ',
  );

const currencyRegions: Record<string, string> = {
  AED: 'AE',
  AFN: 'AF',
  ALL: 'AL',
  AMD: 'AM',
  ANG: 'CW',
  AOA: 'AO',
  ARS: 'AR',
  AUD: 'AU',
  AWG: 'AW',
  AZN: 'AZ',
  BAM: 'BA',
  BBD: 'BB',
  BDT: 'BD',
  BGN: 'BG',
  BHD: 'BH',
  BIF: 'BI',
  BMD: 'BM',
  BND: 'BN',
  BOB: 'BO',
  BRL: 'BR',
  BSD: 'BS',
  BTN: 'BT',
  BWP: 'BW',
  BYN: 'BY',
  BZD: 'BZ',
  CAD: 'CA',
  CDF: 'CD',
  CHF: 'CH',
  CLP: 'CL',
  CNY: 'CN',
  COP: 'CO',
  CRC: 'CR',
  CUC: 'CU',
  CUP: 'CU',
  CVE: 'CV',
  CZK: 'CZ',
  DJF: 'DJ',
  DKK: 'DK',
  DOP: 'DO',
  DZD: 'DZ',
  EGP: 'EG',
  ERN: 'ER',
  ETB: 'ET',
  EUR: 'EU',
  FJD: 'FJ',
  FKP: 'FK',
  GBP: 'GB',
  GEL: 'GE',
  GHS: 'GH',
  GIP: 'GI',
  GMD: 'GM',
  GNF: 'GN',
  GTQ: 'GT',
  GYD: 'GY',
  HKD: 'HK',
  HNL: 'HN',
  HRK: 'HR',
  HTG: 'HT',
  HUF: 'HU',
  IDR: 'ID',
  ILS: 'IL',
  INR: 'IN',
  IQD: 'IQ',
  IRR: 'IR',
  ISK: 'IS',
  JMD: 'JM',
  JOD: 'JO',
  JPY: 'JP',
  KES: 'KE',
  KGS: 'KG',
  KHR: 'KH',
  KMF: 'KM',
  KPW: 'KP',
  KRW: 'KR',
  KWD: 'KW',
  KYD: 'KY',
  KZT: 'KZ',
  LAK: 'LA',
  LBP: 'LB',
  LKR: 'LK',
  LRD: 'LR',
  LSL: 'LS',
  LYD: 'LY',
  MAD: 'MA',
  MDL: 'MD',
  MGA: 'MG',
  MKD: 'MK',
  MMK: 'MM',
  MNT: 'MN',
  MOP: 'MO',
  MRU: 'MR',
  MUR: 'MU',
  MVR: 'MV',
  MWK: 'MW',
  MXN: 'MX',
  MYR: 'MY',
  MZN: 'MZ',
  NAD: 'NA',
  NGN: 'NG',
  NIO: 'NI',
  NOK: 'NO',
  NPR: 'NP',
  NZD: 'NZ',
  OMR: 'OM',
  PAB: 'PA',
  PEN: 'PE',
  PGK: 'PG',
  PHP: 'PH',
  PKR: 'PK',
  PLN: 'PL',
  PYG: 'PY',
  QAR: 'QA',
  RON: 'RO',
  RSD: 'RS',
  RUB: 'RU',
  RWF: 'RW',
  SAR: 'SA',
  SBD: 'SB',
  SCR: 'SC',
  SDG: 'SD',
  SEK: 'SE',
  SGD: 'SG',
  SHP: 'SH',
  SLE: 'SL',
  SLL: 'SL',
  SOS: 'SO',
  SRD: 'SR',
  SSP: 'SS',
  STN: 'ST',
  SVC: 'SV',
  SYP: 'SY',
  SZL: 'SZ',
  THB: 'TH',
  TJS: 'TJ',
  TMT: 'TM',
  TND: 'TN',
  TOP: 'TO',
  TRY: 'TR',
  TTD: 'TT',
  TWD: 'TW',
  TZS: 'TZ',
  UAH: 'UA',
  UGX: 'UG',
  USD: 'US',
  UYU: 'UY',
  UZS: 'UZ',
  VES: 'VE',
  VND: 'VN',
  VUV: 'VU',
  WST: 'WS',
  XAF: 'CM',
  XCD: 'AG',
  XCG: 'CW',
  XOF: 'SN',
  XPF: 'PF',
  YER: 'YE',
  ZAR: 'ZA',
  ZMW: 'ZM',
  ZWG: 'ZW',
  ZWL: 'ZW',
};

function getFlag(code: string) {
  const region = currencyRegions[code];
  if (!region) return '🌐';
  return String.fromCodePoint(
    ...Array.from(region, (letter) => 127397 + letter.charCodeAt(0)),
  );
}

const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
const currencies = currencyCodes.map((code) => ({
  code,
  flag: getFlag(code),
  name: currencyNames.of(code) ?? code,
}));

type CurrencySelectProps = {
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  disabled?: boolean;
  /** Provide non-currency choices while reusing the currency selector UI. */
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
};

export function CurrencySelect({
  value,
  onChange,
  labelledBy,
  disabled = false,
  options,
  placeholder = 'Select currency',
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selected = currencies.find((currency) => currency.code === value);
  const visibleCurrencies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? currencies.filter(
          ({ code, name }) =>
            code.toLocaleLowerCase().includes(normalizedQuery) ||
            name.toLocaleLowerCase().includes(normalizedQuery),
        )
      : currencies;
  }, [query]);
  const visibleOptions = useMemo(() => {
    if (!options)
      return visibleCurrencies.map((currency) => ({
        value: currency.code,
        label: currency.name,
        currency,
      }));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return options
      .filter((option) =>
        option.label.toLocaleLowerCase().includes(normalizedQuery),
      )
      .map((option) => ({ ...option, currency: null }));
  }, [options, query, visibleCurrencies]);

  useEffect(() => {
    if (!open) return;
    if (options) optionRefs.current[0]?.focus();
    else search.current?.focus();
    const handleOutsideClick = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () =>
      document.removeEventListener('pointerdown', handleOutsideClick);
  }, [open, options]);

  function closeMenu() {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  }

  function selectCurrency(code: string) {
    onChange(code);
    closeMenu();
  }

  function focusOption(index: number) {
    optionRefs.current[index]?.focus();
  }

  const selectedOption = options?.find((option) => option.value === value);
  const selectedLabel = selectedOption
    ? selectedOption.label
    : selected
      ? `${selected.flag} ${selected.code} — ${selected.name}`
      : value
        ? `${getFlag(value)} ${value}`
        : placeholder;

  return (
    <div className={`currency-select${open ? ' is-open' : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="currency-select-trigger"
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      <div className="currency-select-menu" aria-hidden={!open} inert={!open}>
        {options ? null : (
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-label="Search currencies"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            placeholder="Search by currency or code"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
              } else if (event.key === 'ArrowDown' && visibleOptions.length) {
                event.preventDefault();
                focusOption(0);
              }
            }}
          />
        )}
        <div className="currency-select-options" id={listboxId} role="listbox">
          {visibleOptions.length ? (
            visibleOptions.map((option, index) => (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={`currency-select-option${option.currency ? '' : ' currency-select-option--plain'}`}
                onClick={() => selectCurrency(option.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu();
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    focusOption(Math.min(index + 1, visibleOptions.length - 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (index === 0) {
                      if (search.current) search.current.focus();
                      else trigger.current?.focus();
                    } else focusOption(index - 1);
                  }
                }}
              >
                {option.currency ? (
                  <>
                    <span className="currency-select-flag" aria-hidden="true">
                      {option.currency.flag}
                    </span>
                    <span className="currency-select-code">
                      {option.currency.code}
                    </span>
                    <span className="currency-select-name">
                      {option.currency.name}
                    </span>
                  </>
                ) : (
                  <span className="currency-select-name">{option.label}</span>
                )}
                {value === option.value ? (
                  <Check size={16} aria-hidden="true" />
                ) : null}
              </button>
            ))
          ) : (
            <p className="currency-select-empty">
              {options ? 'No options found' : 'No currencies found'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
