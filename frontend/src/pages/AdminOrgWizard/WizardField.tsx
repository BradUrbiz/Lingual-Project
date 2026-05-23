import type { ReactNode } from 'react';

export interface WizardFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function WizardField({
  label, htmlFor, required, helper, error, children,
}: WizardFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
        {required && <span aria-hidden className="ml-1 text-red-600">*</span>}
      </label>
      {children}
      {helper && (
        <p className="text-xs text-muted-foreground">{helper}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
