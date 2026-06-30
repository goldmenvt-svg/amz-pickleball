'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatVND } from '@/lib/utils';
import { getTournamentOS, getEventsByTournament } from '@/lib/firestore';
import type { TournamentOS, EventOS, EventOSType } from '@/types';

const STATUS_LABEL: Record<TournamentOS['status'], string> = {
  draft:   'Nháp',
  open:    'Đang đăng ký',
  ongoing: 'Đang thi đấu',
  closed:  'Đã kết thúc',
};
const STATUS_BADGE: Record<TournamentOS['status'], 'success' | 'accent' | 'default' | 'info'> = {
  draft:   'info',
  open:    'success',
  ongoing: 'accent',
  closed:  'default',
};
const EVENT_TYPE_LABEL: Record<EventOSType, string> = {
  mens_doubles:    'Đôi nam',
  womens_doubles:  'Đôi nữ',
  mixed:           'Mixed đôi',
  mens_singles:    'Đơn nam',
  womens_singles:  'Đơn nữ',
};
const EVENT_STATUS_BADGE: Record<EventOS['status'], 'success' | 'warning' | 'default'> = {
  open:   'success',
  full:   'warning',
  closed: 'default',
};
const EVENT_STATUS_LABEL: Record<EventOS['status'], string> = {
  open:   'Mở đăng ký',
  full:   'Đã đủ chỗ',
  closed: 'Đã đóng',
};

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<TournamentOS | null>(null);
  const [events, setEvents] = useState<EventOS[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const t = await getTournamentOS(id);
        if (!t) { setNotFound(true); return; }
        const es = await getEventsByTournament(id);
        setTournament(t);
        setEvents(es);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-white/5 rounded" />
          <div className="h-4 w-96 bg-white/5 rounded" />
          <div className="h-32 bg-white/5 rounded-xl" />
          <div className="h-32 bg-white/5 rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (notFound || !tournament) {
    return (
      <AppShell>
        <div className="text-center py-20 text-muted">
          <p className="text-4xl mb-4">❌</p>
          <p className="font-semibold">Không tìm thấy giải đấu này.</p>
          <Link href="/giai-dau" className="mt-4 inline-block text-accent text-sm">
            ← Quay lại danh sách giải
          </Link>
        </div>
      </AppShell>
    );
  }

  const startDate = new Date(tournament.start_date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const endDate   = new Date(tournament.end_date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sameDay   = tournament.start_date === tournament.end_date;
  const isOpen    = tournament.status === 'open';
  const hasResults = tournament.status === 'ongoing' || tournament.status === 'closed';

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-2">
        <Link href="/giai-dau" className="text-muted text-sm hover:text-white transition-colors">
          ← Tất cả giải đấu
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant={STATUS_BADGE[tournament.status]}>
              {STATUS_LABEL[tournament.status]}
            </Badge>
          </div>
          <h1 className="text-3xl font-black mb-1">{tournament.name}</h1>
          {tournament.description && (
            <p className="text-muted max-w-xl">{tournament.description}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {isOpen && (
            <Link href={`/giai-dau/${id}/dang-ky`}>
              <Button>Đăng ký ngay</Button>
            </Link>
          )}
          {hasResults && (
            <>
              <Link href={`/giai-dau/${id}/lich`}>
                <Button variant="outline">Lịch thi đấu</Button>
              </Link>
              <Link href={`/giai-dau/${id}/ket-qua`}>
                <Button variant="outline">Kết quả</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Info strip */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Ngày thi đấu</p>
            <p className="font-semibold">
              {sameDay ? startDate : `${startDate} → ${endDate}`}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Địa điểm</p>
            <p className="font-semibold">{tournament.venue || '179 Thống Nhất, TP.HCM'}</p>
          </div>
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Số sân</p>
            <p className="font-semibold">{tournament.court_count || 8} sân</p>
          </div>
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Nội dung thi đấu</p>
            <p className="font-semibold">{events.length} nội dung</p>
          </div>
        </div>
      </Card>

      {/* Events */}
      <h2 className="text-xl font-black mb-3">Nội dung thi đấu</h2>
      {events.length === 0 ? (
        <p className="text-muted text-sm">Chưa có nội dung thi đấu.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map(e => {
            const isSingles = e.event_type === 'mens_singles' || e.event_type === 'womens_singles';
            return (
              <Card key={e.id}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={EVENT_STATUS_BADGE[e.status]}>
                        {EVENT_STATUS_LABEL[e.status]}
                      </Badge>
                      <Badge variant="default">{EVENT_TYPE_LABEL[e.event_type]}</Badge>
                      {isSingles && <Badge variant="default">Đơn</Badge>}
                    </div>
                    <h3 className="font-bold">{e.name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
                      <span className="text-muted">
                        Rating: <span className="text-white">{e.rating_min}–{e.rating_max}</span>
                      </span>
                      <span className="text-muted">
                        Tối đa: <span className="text-white">{e.max_players} {isSingles ? 'VĐV' : 'đôi'}</span>
                      </span>
                      <span className="text-muted">
                        Phí:{' '}
                        <span className={e.entry_fee === 0 ? 'text-accent font-bold' : 'text-white font-bold'}>
                          {e.entry_fee === 0 ? 'Miễn phí' : formatVND(e.entry_fee)}
                        </span>
                      </span>
                    </div>
                  </div>
                  {isOpen && e.status === 'open' && (
                    <Link href={`/giai-dau/${id}/dang-ky?event=${e.id}`}>
                      <Button size="sm">Đăng ký</Button>
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Quick nav */}
      {hasResults && (
        <div className="mt-8 grid grid-cols-2 gap-3">
          <Link href={`/giai-dau/${id}/lich`}>
            <Card className="text-center cursor-pointer hover:border-white/20 transition-colors">
              <p className="text-2xl mb-1">📅</p>
              <p className="font-bold text-sm">Lịch thi đấu</p>
              <p className="text-xs text-muted">Sân & giờ thi đấu</p>
            </Card>
          </Link>
          <Link href={`/giai-dau/${id}/ket-qua`}>
            <Card className="text-center cursor-pointer hover:border-white/20 transition-colors">
              <p className="text-2xl mb-1">🏆</p>
              <p className="font-bold text-sm">Kết quả</p>
              <p className="text-xs text-muted">Bảng xếp hạng & tỷ số</p>
            </Card>
          </Link>
        </div>
      )}
    </AppShell>
  );
}
