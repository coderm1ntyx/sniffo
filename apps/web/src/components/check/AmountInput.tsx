import { useState } from 'react';
import { normalizeAmountInput } from './inputSanitizers';

type AmountInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

function formatAmount(value: string) {
  const normalized = value.replaceAll(',', '');
  const parts = normalized.split('.');
  const [integer, fraction] = parts;
  if (
    parts.length > 2 ||
    !/^\d+$/.test(integer) ||
    (fraction !== undefined && !/^\d*$/.test(fraction))
  ) {
    return value;
  }

  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

export function AmountInput({
  value,
  onChange,
  disabled = false,
  placeholder,
}: AmountInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={isFocused ? value : formatAmount(value)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(event) =>
        onChange(normalizeAmountInput(event.currentTarget.value))
      }
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}
