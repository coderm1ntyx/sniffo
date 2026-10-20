import type { MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type PrimaryButtonProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  type?: 'button' | 'submit';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};

export function PrimaryButton({
  children,
  className = '',
  to,
  type = 'button',
  onClick,
  disabled = false,
}: PrimaryButtonProps) {
  const classes = ['primary-button', className].filter(Boolean).join(' ');

  if (to) {
    return (
      <Link className={classes} to={to}>
        {children}
      </Link>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
