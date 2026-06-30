'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
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

const ROUND_LABEL: Record<MatchOS['round_type'], string> = {
  group:        'Vòng bảng',
  quarterfinal: 'Tứ kết',
  semifinal:    'Bán kết',
  final:        'Chung kết',
};

interface Standing {
  reg_id:     string;
  team_name:  string;
  played:     number;
  wins:       number;
  losses:     number;
  games_won:  number;
  games_lost: number;
  points:     number;
}

function computeGroupStandings(
  groupId: string,
  completedMatches: MatchOS[],
  teamNameMap: Record<string, string>
): Standing[] {
  const ms = completedMatches.filter(m => m.group_id === groupId);
  const st: Record<string, Standing> = {};

  const ensure = (regId: string) => {
    if (!st[regId]) {
      st[regId] = {
        reg_id:     regId,
        team_name:  teamNameMap[regId] ?? `Đội ${regId.slice(-4)}`,
        played: 0, wins: 0, losses: 0,
        games_won: 0, games_lost: 0, points: 0,
      };
    }
  };

  ms.forEach(m => {
    if (m.score_a === null || m.score_b === null) return;
    ensure(m.team_a_id);
    ensure(m.team_b_id);
    st[m.team_a_id].played++;
    st[m.team_b_id].played++;
    st[m.team_a_id].games_won  += m.score_a;
    st[m.team_a_id].games_lost += m.score_b;
    st[m.team_b_id].games_won  += m.score_b;
    st[m.team_b_id].games_lost += m.score_a;
    if (m.winner_id === m.team_a_id) {
      st[m.team_a_id].wins++;   st[m.team_a_id].points += 2;
      st[m.team_b_id].losses++; st[m.team_b_id].points += 1;
    } else if (m.winner_id === m.team_b_id) {
      st[m.team_b_id].wins++;   st[m.team_b_id].points += 2;
      st[m.team_a_id].losses++; st[m.team_a_id].points += 1;
    }
  });

  return Object.values(st).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (b.games_won - b.games_lost) - (a.games_won - a.games_lost);
  });
}

function buildTeamNameMap(regs: RegistrationOS[]): Record<string, string> {
  const map: Record<string, string> = {};
  regs.forEach(r => {
    const p1 = r.player_1_name?.trim() || `VĐV-${r.id.slice(-4)}`;
    const p2 = r.player_2_name?.trim();
    map[r.id] = p2 ? `${p1} / ${p2}` : p1;
  });
  return map;
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament]       = useState<TournamentOS | null>(null);
  const [events, setEvents]               = useState<EventOS[]>([]);
  const [groups, setGroups]               = useState<GroupOS[]>([]);
  const [matches, setMatches]             = useState<MatchOS[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationOS[]>([]);
  const [loading, setLoading]             = useState(true);
  const [notFound, setNotFound]           = useState(false);
  const [lastUpdated, setLastUpdated]     = useState<Date | null>(null);

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

  const teamNameMap = useMemo(() => buildTeamNameMap(registrations), [registrations]);

  const completedMatches    = useMemo(() => matches.filter(m => m.status === 'completed'), [matches]);
  const groupMatches        = useMemo(() => completedMatches.filter(m => m.round_type === 'group'), [completedMatches]);
  const knockoutMatches     = useMemo(() => completedMatches.filter(m => m.round_type !== 'group'), [completedMatches]);

  if (loading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-56 bg-white/5 rounded" />
          <div className="h-4 w-40 bg-white/5 rounded" />
          {[1, 2].map(i => <div key={i} className="h-40 bg-white/5 rounded-xl" />)}
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

  const eventNameMap = Object.fromEntries(events.map(e => [e.id, e.name]));

  // Group groups by event
  const groupsByEvent = groups.reduce((acc, g) => {
    if (!acc[g.event_id]) acc[g.event_id] = [];
    acc[g.event_id].push(g);
    return acc;
  }, {} as Record<string, GroupOS[]>);

  const knockoutRounds: MatchOS['round_type'][] = ['quarterfinal', 'semifinal', 'final'];
  const hasAnyResults = completedMatches.length > 0;

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
          <h1 className="text-2xl font-black mb-1">Kết Quả</h1>
          <p className="text-muted text-sm">{tournament.name}</p>
        </div>
        <div className="text-right">
          {lastUpdated && (
            <p className="text-xs text-muted">
              Cập nhật {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <div className="flex gap-2 mt-1 justify-end">
            <Link href={`/giai-dau/${id}/lich`}>
              <button className="text-xs text-muted hover:text-white transition-colors">
                Xem lịch →
              </button>
            </Link>
          </div>
        </div>
      </div>

      {!hasAnyResults ? (
        <div className="text-center py-16 text-muted">
          <p className="text-4xl mb-3">⏳</p>
          <p className="font-semibold">Chưa có kết quả nào.</p>
          <p className="text-sm mt-1">Kết quả sẽ được cập nhật khi các trận hoàn thành.</p>
        </div>
      ) : (
        <>
          {/* Group standings per event */}
          {events.map(ev => {
            const evGroups = (groupsByEvent[ev.id] ?? []).sort((a, b) => a.group_order - b.group_order);
            if (!evGroups.length) return null;
            return (
              <div key={ev.id} className="mb-8">
                <h2 className="text-lg font-black mb-1">{ev.name}</h2>
                <p className="text-xs text-muted uppercase tracking-widest mb-3">Bảng xếp hạng vòng bảng</p>
                <div className="flex flex-col gap-4">
                  {evGroups.map(g => {
                    const standings = computeGroupStandings(g.id, groupMatches, teamNameMap);
                    if (!standings.length) return null;
                    return (
                      <div key={g.id}>
                        <p className="text-xs font-bold text-muted uppercase tracking-widest mb-2">
                          {g.name}
                        </p>
                        <div className="rounded-xl border border-white/7 overflow-hidden">
                          {/* Table header */}
                          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted bg-white/3">
                            <span>Đội</span>
                            <span className="w-7 text-center">T</span>
                            <span className="w-7 text-center">W</span>
                            <span className="w-7 text-center">L</span>
                            <span className="w-10 text-center">+/-</span>
                            <span className="w-8 text-center">Pts</span>
                          </div>
                          {standings.map((s, idx) => (
                            <div
                              key={s.reg_id}
                              className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 px-4 py-3 text-sm border-t border-white/5 items-center
                                ${idx < 2 ? 'bg-accent/5' : ''}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {idx < 2 && (
                                  <span className="shrink-0 w-4 h-4 rounded-full bg-accent text-black text-[10px] font-black flex items-center justify-center">
                                    {idx + 1}
                                  </span>
                                )}
                                {idx >= 2 && (
                                  <span className="shrink-0 w-4 h-4 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center">
                                    {idx + 1}
                                  </span>
                                )}
                                <span className="font-semibold truncate" title={s.team_name}>
                                  {s.team_name}
                                </span>
                              </div>
                              <span className="w-7 text-center tabular-nums text-muted">{s.played}</span>
                              <span className="w-7 text-center tabular-nums text-green-400 font-bold">{s.wins}</span>
                              <span className="w-7 text-center tabular-nums text-red-400">{s.losses}</span>
                              <span className="w-10 text-center tabular-nums text-muted text-xs">
                                {s.games_won}-{s.games_lost}
                              </span>
                              <span className={`w-8 text-center tabular-nums font-black ${idx < 2 ? 'text-accent' : ''}`}>
                                {s.points}
                              </span>
                            </div>
                          ))}
                        </div>
                        {standings.length >= 2 && (
                          <p className="text-[11px] text-muted mt-1.5">
                            ↑ Top 2 vào vòng knockout
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Knockout results */}
          {knockoutMatches.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-black mb-3">Vòng Loại Trực Tiếp</h2>
              {knockoutRounds.map(round => {
                const ms = knockoutMatches.filter(m => m.round_type === round);
                if (!ms.length) return null;
                return (
                  <div key={round} className="mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">
                      {ROUND_LABEL[round]}
                    </p>
                    <div className="flex flex-col gap-2">
                      {ms.map(m => {
                        const teamA  = teamNameMap[m.team_a_id] ?? `Đội ${m.team_a_id?.slice(-4)}`;
                        const teamB  = teamNameMap[m.team_b_id] ?? `Đội ${m.team_b_id?.slice(-4)}`;
                        const aWin   = m.winner_id === m.team_a_id;
                        const bWin   = m.winner_id === m.team_b_id;
                        const evName = eventNameMap[m.event_id] ?? '';
                        return (
                          <Card key={m.id} padding={false}>
                            <div className="px-4 py-3">
                              {evName && (
                                <p className="text-[11px] text-muted mb-1.5">{evName}</p>
                              )}
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className={`font-bold text-sm truncate ${aWin ? 'text-accent' : 'text-white'}`}>
                                    {aWin && '🏆 '}{teamA}
                                  </p>
                                </div>
                                <div className="shrink-0 flex items-center gap-1.5 font-black tabular-nums">
                                  <span className={aWin ? 'text-accent' : 'text-muted'}>{m.score_a ?? '—'}</span>
                                  <span className="text-muted text-xs">:</span>
                                  <span className={bWin ? 'text-accent' : 'text-muted'}>{m.score_b ?? '—'}</span>
                                </div>
                                <div className="flex-1 min-w-0 text-right">
                                  <p className={`font-bold text-sm truncate ${bWin ? 'text-accent' : 'text-white'}`}>
                                    {teamB}{bWin && ' 🏆'}
                                  </p>
                                </div>
                              </div>
                              {round === 'final' && m.winner_id && (
                                <div className="mt-2 pt-2 border-t border-white/5 text-center">
                                  <Badge variant="accent">
                                    🥇 Vô địch: {teamNameMap[m.winner_id] ?? 'N/A'}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
