import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'option' | 'google' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  selected?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  selected = false,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-primary text-white px-6 py-3 hover:bg-primary-hover focus:ring-primary disabled:bg-gray-300 disabled:cursor-not-allowed',
    secondary:
      'bg-white text-text border border-gray-300 px-6 py-3 hover:bg-gray-50 focus:ring-primary',
    option: `px-5 py-3 border-2 ${
      selected
        ? 'bg-primary/10 border-primary text-primary'
        : 'bg-white border-gray-200 text-text hover:border-primary/50'
    }`,
    google:
      'bg-white text-text border border-gray-300 px-6 py-3 hover:bg-gray-50 focus:ring-gray-300 flex items-center justify-center gap-2',
    danger:
      'bg-red-500 text-white px-6 py-3 hover:bg-red-600 focus:ring-red-500',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg
            className="animate-spin h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
