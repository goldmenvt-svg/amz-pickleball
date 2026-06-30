'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import VietQRPayment from '@/components/VietQRPayment';
import { formatVND, validatePhone } from '@/lib/utils';
import { getTournamentOS, getEventsByTournament } from '@/lib/firestore';
import type { TournamentOS, EventOS, EventOSType } from '@/types';

const EVENT_TYPE_LABEL: Record<EventOSType, string> = {
  mens_doubles:   'Đôi nam',
  womens_doubles: 'Đôi nữ',
  mixed:          'Mixed đôi',
  mens_singles:   'Đơn nam',
  womens_singles: 'Đơn nữ',
};

function isSinglesType(type: EventOSType) {
  return type === 'mens_singles' || type === 'womens_singles';
}

type Step = 'select' | 'form' | 'payment';

interface FormState {
  name:         string;
  phone:        string;
  email:        string;
  partnerName:  string;
  partnerPhone: string;
}

export default function RegistrationPage() {
  const { id }        = useParams<{ id: string }>();
  const searchParams  = useSearchParams();
  const preEventId    = searchParams.get('event') ?? '';

  const [tournament, setTournament]     = useState<TournamentOS | null>(null);
  const [events, setEvents]             = useState<EventOS[]>([]);
  const [loading, setLoading]           = useState(true);
  const [notFound, setNotFound]         = useState(false);

  const [step, setStep]                 = useState<Step>('select');
  const [selectedEvent, setSelectedEvent] = useState<EventOS | null>(null);
  const [form, setForm]                 = useState<FormState>({
    name: '', phone: '', email: '', partnerName: '', partnerPhone: '',
  });
  const [errors, setErrors]             = useState<Partial<FormState>>({});
  const [submitting, setSubmitting]     = useState(false);
  const [submitError, setSubmitError]   = useState('');

  useEffect(() => {
    async function load() {
      try {
        const t = await getTournamentOS(id);
        if (!t) { setNotFound(true); return; }
        const es = await getEventsByTournament(id);
        setTournament(t);
        setEvents(es);
        if (preEventId) {
          const preEvent = es.find(e => e.id === preEventId && e.status === 'open');
          if (preEvent) { setSelectedEvent(preEvent); setStep('form'); }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, preEventId]);

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.name.trim())    e.name  = 'Vui lòng nhập họ tên';
    if (!form.phone.trim())   e.phone = 'Vui lòng nhập số điện thoại';
    else if (!validatePhone(form.phone.replace(/\s/g, '')))
      e.phone = 'Số điện thoại không hợp lệ (VD: 0901234567)';

    if (selectedEvent && !isSinglesType(selectedEvent.event_type)) {
      if (!form.partnerName.trim())  e.partnerName  = 'Vui lòng nhập tên đối tác';
      if (!form.partnerPhone.trim()) e.partnerPhone = 'Vui lòng nhập SĐT đối tác';
      else if (!validatePhone(form.partnerPhone.replace(/\s/g, '')))
        e.partnerPhone = 'Số điện thoại không hợp lệ';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(evt: React.FormEvent) {
    evt.preventDefault();
    if (!selectedEvent || !validate()) return;
    setSubmitting(true);
    setSubmitError('');
    const singles = isSinglesType(selectedEvent.event_type);
    try {
      await addDoc(collection(db, 'registrations'), {
        event_id:       selectedEvent.id,
        player_1_name:  form.name.trim(),
        player_1_phone: form.phone.replace(/\s/g, ''),
        player_1_email: form.email.trim() || null,
        player_1_id:    null,
        player_2_name:  singles ? null : form.partnerName.trim(),
        player_2_phone: singles ? null : form.partnerPhone.replace(/\s/g, ''),
        player_2_id:    null,
        status:         'pending',
        payment_status: 'pending',
        checkin_status: 'pending',
        seed_number:    0,
        source:         'public',
        created_at:     new Date().toISOString(),
      });
      setStep('payment');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  function field(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }));
  }

  // ─── Loading / Not Found ───────────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <div className="max-w-lg mx-auto animate-pulse space-y-4">
          <div className="h-8 w-64 bg-white/5 rounded" />
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

  if (tournament.status !== 'open') {
    return (
      <AppShell>
        <div className="text-center py-20 text-muted max-w-sm mx-auto">
          <p className="text-4xl mb-4">🔒</p>
          <p className="font-semibold text-white mb-1">Đăng ký đã đóng</p>
          <p className="text-sm">Giải đấu này không còn nhận đăng ký.</p>
          <Link href={`/giai-dau/${id}`} className="mt-4 inline-block text-accent text-sm">
            ← Xem chi tiết giải
          </Link>
        </div>
      </AppShell>
    );
  }

  const openEvents = events.filter(e => e.status === 'open');

  // ─── Step: Select Event ────────────────────────────────────────────────────
  if (step === 'select') {
    return (
      <AppShell>
        <div className="max-w-lg mx-auto">
          <div className="mb-2">
            <Link href={`/giai-dau/${id}`} className="text-muted text-sm hover:text-white transition-colors">
              ← {tournament.name}
            </Link>
          </div>
          <h1 className="text-2xl font-black mb-1">Chọn nội dung thi đấu</h1>
          <p className="text-muted text-sm mb-6">Chọn nội dung bạn muốn tham gia</p>

          {openEvents.length === 0 ? (
            <Card>
              <p className="text-muted text-center py-4">Không có nội dung nào đang mở đăng ký.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {openEvents.map(e => {
                const singles = isSinglesType(e.event_type);
                return (
                  <Card
                    key={e.id}
                    className="cursor-pointer hover:border-white/20 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex flex-wrap gap-2 mb-1">
                          <Badge variant="success">{EVENT_TYPE_LABEL[e.event_type]}</Badge>
                        </div>
                        <p className="font-bold">{e.name}</p>
                        <p className="text-sm text-muted mt-0.5">
                          Rating {e.rating_min}–{e.rating_max} ·{' '}
                          {singles ? 'Thi đơn' : 'Thi đôi'} ·{' '}
                          <span className="text-accent font-bold">
                            {e.entry_fee === 0 ? 'Miễn phí' : formatVND(e.entry_fee)}
                          </span>
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => { setSelectedEvent(e); setStep('form'); }}
                      >
                        Chọn
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // ─── Step: Form ────────────────────────────────────────────────────────────
  if (step === 'form' && selectedEvent) {
    const singles = isSinglesType(selectedEvent.event_type);
    return (
      <AppShell>
        <div className="max-w-lg mx-auto">
          <div className="mb-2">
            <button
              onClick={() => setStep('select')}
              className="text-muted text-sm hover:text-white transition-colors"
            >
              ← Chọn nội dung khác
            </button>
          </div>
          <h1 className="text-2xl font-black mb-1">Thông tin đăng ký</h1>
          <div className="flex flex-wrap gap-2 mb-6">
            <Badge variant="success">{selectedEvent.name}</Badge>
            <Badge variant="default">
              {selectedEvent.entry_fee === 0 ? 'Miễn phí' : formatVND(selectedEvent.entry_fee)}
            </Badge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Card>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
                Thông tin VĐV {!singles ? '1 (bạn)' : ''}
              </p>
              <div className="space-y-3">
                <Input
                  label="Họ và tên *"
                  placeholder="Nguyễn Văn A"
                  value={form.name}
                  onChange={e => field('name', e.target.value)}
                  error={errors.name}
                />
                <Input
                  label="Số điện thoại *"
                  placeholder="0901234567"
                  type="tel"
                  value={form.phone}
                  onChange={e => field('phone', e.target.value)}
                  error={errors.phone}
                />
                <Input
                  label="Email (tuỳ chọn)"
                  placeholder="email@example.com"
                  type="email"
                  value={form.email}
                  onChange={e => field('email', e.target.value)}
                />
              </div>
            </Card>

            {!singles && (
              <Card>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
                  Thông tin VĐV 2 (đối tác)
                </p>
                <div className="space-y-3">
                  <Input
                    label="Họ và tên *"
                    placeholder="Nguyễn Thị B"
                    value={form.partnerName}
                    onChange={e => field('partnerName', e.target.value)}
                    error={errors.partnerName}
                  />
                  <Input
                    label="Số điện thoại *"
                    placeholder="0907654321"
                    type="tel"
                    value={form.partnerPhone}
                    onChange={e => field('partnerPhone', e.target.value)}
                    error={errors.partnerPhone}
                  />
                </div>
              </Card>
            )}

            {submitError && (
              <p className="text-red-400 text-sm text-center">{submitError}</p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={submitting}
              disabled={submitting}
            >
              Xác nhận đăng ký
            </Button>
            <p className="text-xs text-muted text-center">
              Sau khi đăng ký bạn sẽ nhận thông tin chuyển khoản để xác nhận suất thi đấu.
            </p>
          </form>
        </div>
      </AppShell>
    );
  }

  // ─── Step: Payment ─────────────────────────────────────────────────────────
  if (step === 'payment' && selectedEvent) {
    const noteText = `AMZ ${form.phone.replace(/\s/g, '')} ${selectedEvent.name}`;
    const teamName = isSinglesType(selectedEvent.event_type)
      ? form.name
      : `${form.name} / ${form.partnerName}`;
    return (
      <AppShell>
        <div className="max-w-sm mx-auto py-4">
          <VietQRPayment
            amount={selectedEvent.entry_fee}
            noteText={noteText}
            playerName={teamName}
            eventName={selectedEvent.name}
          />
          <div className="mt-6 text-center">
            <Link href={`/giai-dau/${id}`}>
              <Button variant="outline" size="sm">← Quay lại giải đấu</Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return null;
}
