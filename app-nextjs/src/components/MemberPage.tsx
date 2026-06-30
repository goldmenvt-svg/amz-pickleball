'use client';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { formatVND } from '@/lib/utils';

const PLANS = [
  {
    id:    'basic',
    name:  'Cơ Bản',
    price: 500000,
    period: 'tháng',
    badge: null,
    features: [
      'Đặt sân ưu tiên 30 phút',
      'Giảm 10% giá sân',
      'Tham gia giải đấu nội bộ',
      'Tủ đồ cá nhân',
    ],
  },
  {
    id:    'pro',
    name:  'Pro',
    price: 1200000,
    period: 'tháng',
    badge: 'Phổ biến',
    features: [
      'Đặt sân ưu tiên 60 phút',
      'Giảm 20% giá sân',
      'Tham gia tất cả giải đấu',
      'Tủ đồ cá nhân',
      'Thuê vợt miễn phí 2h/tuần',
      'Xếp hạng ELO chính thức',
    ],
  },
  {
    id:    'elite',
    name:  'Elite',
    price: 2500000,
    period: 'tháng',
    badge: 'Toàn diện',
    features: [
      'Đặt sân ưu tiên 90 phút',
      'Giảm 30% giá sân',
      'Tham gia tất cả giải đấu',
      'Tủ đồ cá nhân khóa số',
      'Thuê vợt miễn phí không giới hạn',
      'Xếp hạng ELO chính thức',
      '2 buổi tập 1-on-1/tháng với HLV',
      'Hỗ trợ đăng ký giải đấu liên CLB',
    ],
  },
];

export default function MemberPage() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-black mb-2">Gói Hội Viên</h1>
        <p className="text-muted max-w-md mx-auto text-sm">Trở thành thành viên AMZ Pickleball — ưu đãi sân, tham gia giải đấu và nhiều quyền lợi độc quyền</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {PLANS.map(plan => (
          <Card key={plan.id} className={`relative flex flex-col ${plan.id === 'pro' ? 'border-accent/40' : ''}`}>
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge variant="accent">{plan.badge}</Badge>
              </div>
            )}
            <div className="mb-4">
              <p className="text-xs text-muted uppercase tracking-widest mb-1">{plan.name}</p>
              <div className="flex items-end gap-1">
                <span className="text-3xl font-black">{formatVND(plan.price)}</span>
                <span className="text-muted text-sm mb-1">/{plan.period}</span>
              </div>
            </div>
            <ul className="flex-1 flex flex-col gap-2 mb-6">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className="text-accent mt-0.5 flex-shrink-0">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button variant={plan.id === 'pro' ? 'primary' : 'outline'} className="w-full">
              Đăng ký {plan.name}
            </Button>
          </Card>
        ))}
      </div>

      <div className="text-center">
        <p className="text-sm text-muted mb-2">Cần tư vấn thêm?</p>
        <a href="tel:0914859927" className="text-accent font-bold hover:underline">0914 859 927</a>
        <span className="text-muted mx-2">·</span>
        <a href="https://www.facebook.com/p/AMZ-Pickle-Ball-Club-61574575574795/" target="_blank" rel="noopener noreferrer" className="text-accent font-bold hover:underline">Facebook AMZ</a>
      </div>
    </AppShell>
  );
}
