'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatVND } from '@/lib/utils';
import { getTournamentsOS, getAllEventsOS } from '@/lib/firestore';
import type { TournamentOS, EventOS } from '@/types';

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

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<TournamentOS[]>([]);
  const [eventMap, setEventMap] = useState<Record<string, EventOS[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [ts, es] = await Promise.all([getTournamentsOS(), getAllEventsOS()]);
        const map: Record<string, EventOS[]> = {};
        es.forEach(e => {
          if (!map[e.tournament_id]) map[e.tournament_id] = [];
          map[e.tournament_id].push(e);
        });
        setTournaments(ts);
        setEventMap(map);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="mb-6">
          <div className="h-9 w-48 bg-white/5 rounded animate-pulse mb-2" />
          <div className="h-4 w-72 bg-white/5 rounded animate-pulse" />
        </div>
        <div className="flex flex-col gap-4">
          {[1, 2].map(i => (
            <div key={i} className="h-40 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-black mb-1">Giải Đấu</h1>
        <p className="text-muted text-sm">Lịch thi đấu & đăng ký giải đấu Pickleball tại AMZ</p>
      </div>

      {tournaments.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="text-5xl mb-4">🏆</p>
          <p className="font-semibold">Chưa có giải đấu nào được công bố.</p>
          <p className="text-sm mt-1">Theo dõi Facebook để cập nhật sớm nhất!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tournaments.map(t => {
            const events = eventMap[t.id] ?? [];
            const startDate = new Date(t.start_date).toLocaleDateString('vi-VN');
            const endDate   = new Date(t.end_date).toLocaleDateString('vi-VN');
            const sameDay   = t.start_date === t.end_date;
            const minFee    = events.length ? Math.min(...events.map(e => e.entry_fee)) : 0;

            return (
              <Card key={t.id}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      {events.length > 0 && (
                        <Badge variant="default">{events.length} nội dung</Badge>
                      )}
                    </div>
                    <h2 className="text-lg font-black mb-1 truncate">{t.name}</h2>
                    {t.description && (
                      <p className="text-sm text-muted mb-3 line-clamp-2">{t.description}</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <div>
                        <span className="text-muted">Ngày thi đấu: </span>
                        {sameDay ? startDate : `${startDate} – ${endDate}`}
                      </div>
                      <div>
                        <span className="text-muted">Địa điểm: </span>
                        {t.venue || '179 Thống Nhất, TP.HCM'}
                      </div>
                      {events.length > 0 && (
                        <div className="col-span-2">
                          <span className="text-muted">Nội dung: </span>
                          {events.map(e => e.name).join(' · ')}
                        </div>
                      )}
                      {minFee > 0 && (
                        <div>
                          <span className="text-muted">Phí từ: </span>
                          <span className="text-accent font-bold">{formatVND(minFee)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex sm:flex-col gap-2 sm:items-end shrink-0">
                    {t.status === 'open' && (
                      <Link href={`/giai-dau/${t.id}/dang-ky`}>
                        <Button size="sm">Đăng ký ngay</Button>
                      </Link>
                    )}
                    <Link href={`/giai-dau/${t.id}`}>
                      <Button variant="outline" size="sm">Xem chi tiết</Button>
                    </Link>
                    {(t.status === 'ongoing' || t.status === 'closed') && (
                      <>
                        <Link href={`/giai-dau/${t.id}/lich`}>
                          <Button variant="ghost" size="sm">Lịch thi đấu</Button>
                        </Link>
                        <Link href={`/giai-dau/${t.id}/ket-qua`}>
                          <Button variant="ghost" size="sm">Kết quả</Button>
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
