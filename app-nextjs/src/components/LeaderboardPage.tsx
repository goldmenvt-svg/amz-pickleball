'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import type { Player } from '@/types';

const MOCK_PLAYERS: Player[] = Array.from({ length: 20 }, (_, i) => ({
  id:         `p${i+1}`,
  userId:     null,
  name:       ['Nguyễn Văn An','Trần Thị Bình','Lê Minh Cường','Phạm Thị Dung','Hoàng Văn Em',
                'Vũ Thị Phương','Đặng Minh Quân','Bùi Thị Hoa','Ngô Văn Ích','Dương Thị Kim',
                'Phan Văn Long','Lý Thị Mai','Tô Văn Nam','Đinh Thị Oanh','Chu Văn Phú',
                'Lưu Thị Quỳnh','Hồ Văn Rồng','Tạ Thị Sen','Mai Văn Thắng','Trịnh Thị Uyên'][i],
  phone:      '09' + String(10000000 + i * 111111),
  email:      '',
  photo:      '',
  duprLevel:  +(4.5 - i * 0.2).toFixed(1),
  elo:        1800 - i * 45,
  categories: ['Đơn nam'],
  tier:       i < 5 ? 'Chuyên' : i < 10 ? 'Giỏi' : i < 15 ? 'Khá' : 'Mới',
  note:       '',
  isActive:   true,
  stats:      { totalMatches: 30 - i, wins: 20 - i, losses: 10, tournamentsPlayed: 5, points: 2000 - i * 90 },
  createdAt:  '',
  updatedAt:  '',
}));

const TIER_BADGE: Record<string, 'accent' | 'success' | 'info' | 'default'> = {
  Chuyên: 'accent', Giỏi: 'success', Khá: 'info', Mới: 'default',
};

export default function LeaderboardPage() {
  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState('all');
  const players = MOCK_PLAYERS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-black mb-1">Bảng Xếp Hạng ELO</h1>
        <p className="text-muted text-sm">Cập nhật sau mỗi giải đấu · K-factor 32</p>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          type="search" placeholder="Tìm vận động viên..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-accent transition-colors"
        />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-accent">
          <option value="all">Tất cả</option>
          <option value="Đơn nam">Đơn nam</option>
          <option value="Đơn nữ">Đơn nữ</option>
          <option value="Đôi nam">Đôi nam</option>
          <option value="Đôi hỗn hợp">Đôi hỗn hợp</option>
        </select>
      </div>

      <Card padding={false}>
        <div className="divide-y divide-white/5">
          {players.map((p, i) => (
            <div key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/3 transition-colors">
              <div className={`w-8 text-center font-black text-sm ${i < 3 ? 'text-accent' : 'text-muted'}`}>
                {i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}
              </div>
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/60 flex-shrink-0">
                {p.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{p.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={TIER_BADGE[p.tier] ?? 'default'}>{p.tier}</Badge>
                  <span className="text-xs text-muted">DUPR {p.duprLevel.toFixed(1)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="font-black text-base text-accent">{p.elo}</p>
                <p className="text-xs text-muted">{p.stats.wins}T/{p.stats.losses}B</p>
              </div>
            </div>
          ))}
          {players.length === 0 && (
            <div className="py-12 text-center text-muted text-sm">Không tìm thấy vận động viên</div>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
