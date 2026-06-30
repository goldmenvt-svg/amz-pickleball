import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-white/5 text-white/60',
  success: 'bg-green-500/15 text-green-400',
  warning: 'bg-yellow-500/15 text-yellow-400',
  danger:  'bg-red-500/15 text-red-400',
  info:    'bg-blue-500/15 text-blue-400',
  accent:  'bg-accent/15 text-accent',
};

export default function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide', variants[variant], className)}>
      {children}
    </span>
  );
}
