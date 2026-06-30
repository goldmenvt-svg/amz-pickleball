'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dat-san',      label: 'Đặt sân',       icon: '🏓' },
  { href: '/giai-dau',     label: 'Giải đấu',       icon: '🏆' },
  { href: '/bang-xep-hang',label: 'Xếp hạng ELO',   icon: '📊' },
  { href: '/hoi-vien',     label: 'Hội viên',        icon: '⭐' },
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-white/7 bg-black/80 backdrop-blur-lg">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-black text-lg tracking-tight">
          <span className="w-2 h-2 rounded-full bg-accent" />
          AMZ<em className="text-accent not-italic ml-0.5">PICKLEBALL</em>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith(href)
                  ? 'text-accent bg-accent/10'
                  : 'text-muted hover:text-white hover:bg-white/5'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/dat-san"
          className="bg-accent text-black text-sm font-bold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
        >
          Đặt sân ngay
        </Link>
      </div>
      {/* Mobile nav */}
      <nav className="md:hidden flex border-t border-white/7">
        {navItems.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
              pathname.startsWith(href) ? 'text-accent' : 'text-muted'
            )}
          >
            <span className="text-base">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
