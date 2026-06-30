'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import {
  getTournamentOS, getEventsByTournament,
  getGroupsByEventIds, getMatchesByEventIds, getRegistrationsByEventIds,
} from '@/lib/firestore';
import type { TournamentOS, EventOS, GroupOS, MatchOS, RegistrationOS } from '@/types';

const ROUND_ORDER: Record<MatchOS['round_type'], number> = {
  group: 0, quarterfinal: 1, semifinal: 2, final: 3,
};
const ROUND_LABEL: Record<MatchOS['round_type'], string> = {
  group:        'Vòng bảng',
  quarterfinal: 'Tứ kết',
  semifinal:    'Bán kết',
  final:        'Chung kết',
};
const MATCH_STATUS_BADGE: Record<MatchOS['status'], 'default' | 'accent' | 'success' | 'danger'> = {
  scheduled:  'default',
  ongoing:    'accent',
  completed:  'success',
  cancelled:  'danger',
};
const MATCH_STATUS_LABEL: Record<MatchOS['status'], string> = {
  scheduled:  'Chờ đấu',
  ongoing:    'Đang đấu',
  completed:  'Kết thúc',
  cancelled:  'Hủy',
};

function buildTeamNameMap(regs: RegistrationOS[]): Record<string, string> {
  const map: Record<string, string> = {};
  regs.forEach(r => {
    const p1 = r.player_1_name?.trim() || `VĐV-${r.id.slice(-4)}`;
    const p2 = r.player_2_name?.trim();
    map[r.id] = p2 ? `${p1} / ${p2}` : p1;
  });
  return map;
}

function formatTime(scheduled_time: string | null): string {
  if (!scheduled_time) return '—';
  try {
    return new Date(scheduled_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return scheduled_time;
  }
}

export default function SchedulePage() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament]         = useState<TournamentOS | null>(null);
  const [events, setEvents]                 = useState<EventOS[]>([]);
  const [groups, setGroups]                 = useState<GroupOS[]>([]);
  const [matches, setMatches]               = useState<MatchOS[]>([]);
  const [registrations, setRegistrations]   = useState<RegistrationOS[]>([]);
  const [loading, setLoading]               = useState(true);
  const [notFound, setNotFound]             = useState(false);
  const [lastUpdated, setLastUpdated]       = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const t = await getTournamentOS(id);
      if (!t) { setNotFound(true); setLoading(false); return; }
      setTournament(t);

      const evs = await getEventsByTournament(id);
      setEvents(evs);

      const eventIds = evs.map(e => e.id);
      if (eventIds.length) {
        const [grps, mats, regs] = await Promise.all([
          getGroupsByEventIds(eventIds),
          getMatchesByEventIds(eventIds),
          getRegistrationsByEventIds(eventIds),
        ]);
        setGroups(grps);
        setMatches(mats);
        setRegistrations(regs);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-56 bg-white/5 rounded" />
          <div className="h-4 w-40 bg-white/5 rounded" />
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
        </div>
      </AppShell>
    );
  }

  if (notFound || !tournament) {
    return (
      <AppShell>
        <div className="text-center py-20 text-muted">
          <p className="text-4xl mb-4">❌</p>
          <p className="font-semibold">Không tìm thấy giải đấu.</p>
          <Link href="/giai-dau" className="mt-4 inline-block text-accent text-sm">← Danh sách giải</Link>
        </div>
      </AppShell>
    );
  }

  const teamNameMap  = buildTeamNameMap(registrations);
  const groupNameMap = Object.fromEntries(groups.map(g => [g.id, g.name]));
  const eventNameMap = Object.fromEntries(events.map(e => [e.id, e.name]));

  const scheduledMatches = matches.filter(m => m.scheduled_time !== null);
  const unscheduled      = matches.filter(m => m.scheduled_time === null && m.status !== 'cancelled');

  const sorted = [...scheduledMatches].sort((a, b) => {
    const roundDiff = ROUND_ORDER[a.round_type] - ROUND_ORDER[b.round_type];
    if (roundDiff !== 0) return roundDiff;
    return (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? '');
  });

  const grouped: Record<string, MatchOS[]> = {};
  sorted.forEach(m => {
    const key = m.round_type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  });

  const rounds = Object.keys(grouped).sort(
    (a, b) => ROUND_ORDER[a as MatchOS['round_type']] - ROUND_ORDER[b as MatchOS['round_type']]
  ) as MatchOS['round_type'][];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-2">
        <Link href={`/giai-dau/${id}`} className="text-muted text-sm hover:text-white transition-colors">
          ← {tournament.name}
        </Link>
      </div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black mb-1">Lịch Thi Đấu</h1>
          <p className="text-muted text-sm">{tournament.name}</p>
        </div>
        <div className="text-right">
          {lastUpdated && (
            <p className="text-xs text-muted">
              Cập nhật lúc {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <p className="text-xs text-muted">Tự động làm mới mỗi 60s</p>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-semibold">Lịch thi đấu chưa được công bố.</p>
          <p className="text-sm mt-1">Vui lòng theo dõi fanpage để cập nhật.</p>
        </div>
      ) : (
        <>
          {rounds.map(round => (
            <div key={round} className="mb-6">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">
                {ROUND_LABEL[round]}
              </h2>
              <div className="flex flex-col gap-2">
                {grouped[round].map(m => {
                  const teamA    = teamNameMap[m.team_a_id] ?? `Đội ${m.team_a_id?.slice(-4) ?? '?'}`;
                  const teamB    = teamNameMap[m.team_b_id] ?? `Đội ${m.team_b_id?.slice(-4) ?? '?'}`;
                  const groupName = m.group_id ? groupNameMap[m.group_id] : null;
                  const eventName = eventNameMap[m.event_id] ?? '';
                  const time      = formatTime(m.scheduled_time);

                  return (
                    <Card key={m.id} padding={false}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Time + court */}
                        <div className="shrink-0 w-16 text-center">
                          <p className="text-sm font-black tabular-nums">{time}</p>
                          {m.court_number && (
                            <p className="text-[11px] text-muted mt-0.5">Sân {m.court_number}</p>
                          )}
                        </div>
                        <div className="w-px h-8 bg-white/7 shrink-0" />
                        {/* Teams */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`font-semibold truncate ${m.winner_id === m.team_a_id ? 'text-accent' : ''}`}>
                              {teamA}
                            </span>
                            <span className="text-muted shrink-0 text-xs">vs</span>
                            <span className={`font-semibold truncate ${m.winner_id === m.team_b_id ? 'text-accent' : ''}`}>
                              {teamB}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {groupName && (
                              <span className="text-[11px] text-muted">{groupName}</span>
                            )}
                            {eventName && (
                              <span className="text-[11px] text-muted">· {eventName}</span>
                            )}
                          </div>
                        </div>
                        {/* Score + status */}
                        <div className="shrink-0 text-right">
                          {m.status === 'completed' && m.score_a !== null ? (
                            <p className="font-black tabular-nums text-sm">
                              {m.score_a} – {m.score_b}
                            </p>
                          ) : (
                            <Badge variant={MATCH_STATUS_BADGE[m.status]}>
                              {MATCH_STATUS_LABEL[m.status]}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}

          {unscheduled.length > 0 && (
            <div className="mt-4 border-t border-white/7 pt-4">
              <p className="text-xs text-muted uppercase tracking-widest mb-2">
                Chưa có lịch ({unscheduled.length} trận)
              </p>
              <div className="flex flex-col gap-2">
                {unscheduled.map(m => {
                  const teamA = teamNameMap[m.team_a_id] ?? `Đội ${m.team_a_id?.slice(-4) ?? '?'}`;
                  const teamB = teamNameMap[m.team_b_id] ?? `Đội ${m.team_b_id?.slice(-4) ?? '?'}`;
                  return (
                    <Card key={m.id} padding={false}>
                      <div className="flex items-center gap-3 px-4 py-3 opacity-50">
                        <div className="shrink-0 w-16 text-center text-muted text-xs">TBD</div>
                        <div className="w-px h-6 bg-white/7 shrink-0" />
                        <div className="flex-1 text-sm">
                          <span className="font-semibold">{teamA}</span>
                          <span className="text-muted mx-2">vs</span>
                          <span className="font-semibold">{teamB}</span>
                        </div>
                        <Badge variant="default">{ROUND_LABEL[m.round_type]}</Badge>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
