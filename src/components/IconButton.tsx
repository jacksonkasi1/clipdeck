// ** import types
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
  active?: boolean;
  tone?: 'default' | 'danger';
}

export function IconButton({
  label,
  children,
  active,
  tone = 'default',
  className = '',
  ...props
}: IconButtonProps) {
  const isToggle = active !== undefined;
  const classes = [
    'icon-button',
    active ? 'is-active' : '',
    tone === 'danger' ? 'is-danger' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={isToggle ? active : undefined}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
