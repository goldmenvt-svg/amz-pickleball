import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?:    'sm' | 'md' | 'lg';
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
    const variants = {
      primary: 'bg-accent text-black hover:bg-accent/90 active:scale-[0.98]',
      outline: 'border border-white/10 text-white hover:border-white/25 hover:bg-white/5',
      ghost:   'text-muted hover:text-white hover:bg-white/5',
      danger:  'bg-red-600 text-white hover:bg-red-700',
    };
    const sizes = {
      sm: 'text-xs px-3 py-2',
      md: 'text-sm px-4 py-2.5',
      lg: 'text-base px-6 py-3',
    };
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30" strokeDashoffset="10" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
export default Button;
