'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { formatVND, formatDate, generateTimeSlots, validatePhone } from '@/lib/utils';
import type { Court, Booking } from '@/types';

// ── Step types ────────────────────────────────────────────────────────────
type Step = 'date' | 'court' | 'time' | 'info' | 'confirm';

interface BookingDraft {
  date:         string;
  courtId:      string;
  courtName:    string;
  startTime:    string;
  endTime:      string;
  playerName:   string;
  playerPhone:  string;
  note:         string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getNext14Days(): string[] {
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === today)    return 'Hôm nay';
  if (dateStr === tomorrow) return 'Ngày mai';
  return d.toLocaleDateString('vi-VN', { weekday: 'short' });
}

const MOCK_COURTS: Court[] = Array.from({ length: 8 }, (_, i) => ({
  id:           `court-${i + 1}`,
  name:         `Sân ${i + 1}`,
  type:         i < 4 ? 'indoor' : 'outdoor',
  surface:      'Pro Series',
  pricePerHour: i < 4 ? 120000 : 100000,
  amenities:    i < 4 ? ['Đèn chiếu sáng', 'Máy lạnh', 'Mái che'] : ['Đèn chiếu sáng', 'Mái che'],
  photos:       [],
  status:       'available',
  position:     i + 1,
  createdAt:    '',
  updatedAt:    '',
}));

const SLOT_DURATION = 1; // giờ mặc định

export default function BookingPage() {
  const [step, setStep]         = useState<Step>('date');
  const [draft, setDraft]       = useState<Partial<BookingDraft>>({});
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]         = useState(false);
  const [errors, setErrors]     = useState<Record<string, string>>({});

  const allSlots = generateTimeSlots(5, 23);

  const update = (key: keyof BookingDraft, val: string) =>
    setDraft(prev => ({ ...prev, [key]: val }));

  function validateInfo(): boolean {
    const e: Record<string, string> = {};
    if (!draft.playerName?.trim())    e.playerName  = 'Vui lòng nhập họ tên';
    if (!validatePhone(draft.playerPhone ?? '')) e.playerPhone = 'SĐT không hợp lệ (10 số, bắt đầu 03/05/07/08/09)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validateInfo()) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 1200)); // TODO: gọi createBooking()
    setSubmitting(false);
    setDone(true);
  }

  const totalAmount = (() => {
    if (!draft.startTime || !draft.endTime || !draft.courtId) return 0;
    const court = MOCK_COURTS.find(c => c.id === draft.courtId);
    const [sh, sm] = draft.startTime.split(':').map(Number);
    const [eh, em] = draft.endTime.split(':').map(Number);
    const hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    return Math.max(0, hours) * (court?.pricePerHour ?? 0);
  })();

  if (done) return (
    <AppShell>
      <div className="max-w-md mx-auto text-center py-20 fade-in">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-black mb-2">Đặt sân thành công!</h1>
        <p className="text-muted text-sm mb-2">
          {draft.courtName} · {draft.date && new Date(draft.date).toLocaleDateString('vi-VN')}
        </p>
        <p className="text-muted text-sm mb-6">
          {draft.startTime} – {draft.endTime} · {formatVND(totalAmount)}
        </p>
        <p className="text-xs text-white/40 mb-8">
          Nhân viên sẽ xác nhận qua SĐT {draft.playerPhone} trong vòng 15 phút.
        </p>
        <Button onClick={() => { setStep('date'); setDraft({}); setDone(false); }}>
          Đặt sân khác
        </Button>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-6">
          {(['date','court','time','info','confirm'] as Step[]).map((s, i) => {
            const labels = ['Chọn ngày','Chọn sân','Chọn giờ','Thông tin','Xác nhận'];
            const idx = (['date','court','time','info','confirm'] as Step[]).indexOf(step);
            const done = i < idx;
            const current = s === step;
            return (
              <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-colors
                  ${done ? 'bg-accent text-black' : current ? 'bg-accent/20 text-accent border border-accent' : 'bg-white/5 text-muted'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${current ? 'text-white' : 'text-muted'}`}>{labels[i]}</span>
                {i < 4 && <div className={`flex-1 h-px ${i < idx ? 'bg-accent/40' : 'bg-white/7'}`} />}
              </div>
            );
          })}
        </div>

        {/* ── Step: Date ── */}
        {step === 'date' && (
          <div className="fade-in">
            <h2 className="text-xl font-black mb-4">Chọn ngày đặt sân</h2>
            <div className="grid grid-cols-7 gap-2">
              {getNext14Days().map(d => (
                <button key={d} onClick={() => { update('date', d); setStep('court'); }}
                  className={`flex flex-col items-center p-3 rounded-xl border transition-all hover:border-accent/50
                    ${draft.date === d ? 'border-accent bg-accent/10 text-accent' : 'border-white/7 bg-surface text-white'}`}>
                  <span className="text-[10px] text-muted mb-1">{dayLabel(d)}</span>
                  <span className="text-lg font-bold">{new Date(d).getDate()}</span>
                  <span className="text-[10px] text-muted">{new Date(d).toLocaleDateString('vi-VN',{month:'short'})}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step: Court ── */}
        {step === 'court' && (
          <div className="fade-in">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setStep('date')} className="text-muted hover:text-white text-sm">← Quay lại</button>
              <h2 className="text-xl font-black">Chọn sân</h2>
              <Badge variant="info">{draft.date && new Date(draft.date).toLocaleDateString('vi-VN')}</Badge>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {MOCK_COURTS.map(court => (
                <Card key={court.id} padding={false}
                  className={`cursor-pointer hover:border-white/20 transition-all ${draft.courtId === court.id ? 'border-accent' : ''}`}>
                  <button className="w-full text-left p-4" onClick={() => { update('courtId', court.id); update('courtName', court.name); setStep('time'); }}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold">{court.name}</p>
                        <p className="text-xs text-muted">{court.type === 'indoor' ? 'Trong nhà' : 'Ngoài trời'} · {court.surface}</p>
                      </div>
                      <Badge variant={court.status === 'available' ? 'success' : 'danger'}>
                        {court.status === 'available' ? 'Trống' : 'Bận'}
                      </Badge>
                    </div>
                    <p className="text-accent font-bold text-sm">{formatVND(court.pricePerHour)}/giờ</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {court.amenities.map(a => <span key={a} className="text-[10px] text-muted bg-white/5 px-2 py-0.5 rounded-full">{a}</span>)}
                    </div>
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Step: Time ── */}
        {step === 'time' && (
          <div className="fade-in">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setStep('court')} className="text-muted hover:text-white text-sm">← Quay lại</button>
              <h2 className="text-xl font-black">Chọn giờ</h2>
              <Badge variant="info">{draft.courtName}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-xs text-muted uppercase tracking-widest mb-2 block">Giờ bắt đầu</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {allSlots.map(s => (
                    <button key={s} onClick={() => { update('startTime', s); update('endTime', ''); }}
                      className={`py-2 text-xs font-medium rounded-lg border transition-colors
                        ${bookedSlots.includes(s) ? 'opacity-30 cursor-not-allowed bg-red-500/10 border-red-500/20 text-red-400' :
                          draft.startTime === s ? 'border-accent bg-accent/15 text-accent' : 'border-white/7 hover:border-white/20 bg-surface'}`}
                      disabled={bookedSlots.includes(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-widest mb-2 block">Giờ kết thúc</label>
                {draft.startTime ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {allSlots.filter(s => s > draft.startTime!).slice(0, 8).map(s => (
                      <button key={s} onClick={() => update('endTime', s)}
                        className={`py-2 text-xs font-medium rounded-lg border transition-colors
                          ${draft.endTime === s ? 'border-accent bg-accent/15 text-accent' : 'border-white/7 hover:border-white/20 bg-surface'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted mt-4">Chọn giờ bắt đầu trước</p>}
              </div>
            </div>
            {draft.startTime && draft.endTime && (
              <div className="flex justify-between items-center p-4 rounded-xl bg-surface border border-white/7 mb-4">
                <div>
                  <p className="text-sm font-bold">{draft.startTime} – {draft.endTime}</p>
                  <p className="text-xs text-muted">{draft.courtName}</p>
                </div>
                <p className="text-accent font-black text-lg">{formatVND(totalAmount)}</p>
              </div>
            )}
            <Button disabled={!draft.startTime || !draft.endTime} onClick={() => setStep('info')} size="lg" className="w-full">
              Tiếp tục →
            </Button>
          </div>
        )}

        {/* ── Step: Info ── */}
        {step === 'info' && (
          <div className="fade-in max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setStep('time')} className="text-muted hover:text-white text-sm">← Quay lại</button>
              <h2 className="text-xl font-black">Thông tin đặt sân</h2>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-muted uppercase tracking-widest mb-1.5 block">Họ và tên *</label>
                <input
                  type="text" placeholder="Nguyễn Văn A"
                  value={draft.playerName || ''}
                  onChange={e => { update('playerName', e.target.value); setErrors(p => ({ ...p, playerName: '' })); }}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-accent transition-colors"
                />
                {errors.playerName && <p className="text-xs text-red-400 mt-1">{errors.playerName}</p>}
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-widest mb-1.5 block">Số điện thoại *</label>
                <input
                  type="tel" placeholder="0901234567"
                  value={draft.playerPhone || ''}
                  onChange={e => { update('playerPhone', e.target.value); setErrors(p => ({ ...p, playerPhone: '' })); }}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-accent transition-colors"
                />
                {errors.playerPhone && <p className="text-xs text-red-400 mt-1">{errors.playerPhone}</p>}
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-widest mb-1.5 block">Ghi chú (tùy chọn)</label>
                <textarea
                  placeholder="Yêu cầu đặc biệt..."
                  value={draft.note || ''}
                  onChange={e => update('note', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-accent transition-colors resize-none"
                />
              </div>
              <Button onClick={() => { if (validateInfo()) setStep('confirm'); }} size="lg">
                Xem lại →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Confirm ── */}
        {step === 'confirm' && (
          <div className="fade-in max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setStep('info')} className="text-muted hover:text-white text-sm">← Quay lại</button>
              <h2 className="text-xl font-black">Xác nhận đặt sân</h2>
            </div>
            <Card className="mb-4">
              {[
                ['Ngày',       draft.date ? new Date(draft.date).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }) : ''],
                ['Sân',        draft.courtName || ''],
                ['Giờ',        `${draft.startTime} – ${draft.endTime}`],
                ['Họ tên',     draft.playerName || ''],
                ['Số điện thoại', draft.playerPhone || ''],
                ...(draft.note ? [['Ghi chú', draft.note]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5 border-b border-white/5 last:border-0 text-sm">
                  <span className="text-muted">{k}</span>
                  <span className="font-medium text-right max-w-[60%]">{v}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 text-base font-black">
                <span>Tổng tiền</span>
                <span className="text-accent">{formatVND(totalAmount)}</span>
              </div>
            </Card>
            <p className="text-xs text-muted mb-4">
              Nhân viên sẽ xác nhận qua SĐT trong vòng 15 phút. Thanh toán khi đến sân hoặc chuyển khoản.
            </p>
            <Button onClick={handleSubmit} loading={submitting} size="lg" className="w-full">
              {submitting ? 'Đang gửi...' : 'Xác nhận đặt sân'}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
