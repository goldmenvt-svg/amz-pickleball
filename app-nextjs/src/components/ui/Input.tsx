import { cn } from '@/lib/utils';
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:   string;
  error?:   string;
  hint?:    string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-white/60 uppercase tracking-widest">{label}</label>}
      <input
        ref={ref}
        className={cn(
          'w-full px-3 py-2.5 rounded-lg bg-white/5 border text-sm text-white placeholder:text-white/25',
          'focus:outline-none focus:border-accent transition-colors',
          error ? 'border-red-500' : 'border-white/10',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint  && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  )
);
Input.displayName = 'Input';
export default Input;
