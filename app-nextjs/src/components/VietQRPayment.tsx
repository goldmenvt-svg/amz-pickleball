'use client';
import { formatVND } from '@/lib/utils';

const BANK_ID  = process.env.NEXT_PUBLIC_VIETQR_BANK    ?? '';
const ACCOUNT  = process.env.NEXT_PUBLIC_VIETQR_ACCOUNT ?? '';

interface VietQRPaymentProps {
  amount:     number;
  noteText:   string; // plain text for addInfo
  playerName: string;
  eventName:  string;
}

export default function VietQRPayment({ amount, noteText, playerName, eventName }: VietQRPaymentProps) {
  const note   = encodeURIComponent(noteText);
  const hasQR  = BANK_ID && ACCOUNT;
  const qrUrl  = hasQR
    ? `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT}-compact2.png?amount=${amount}&addInfo=${note}`
    : null;

  return (
    <div className="text-center max-w-sm mx-auto">
      <div className="mb-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-500/15 text-3xl mb-3">
          ✓
        </div>
        <h2 className="text-xl font-black mb-1">Đăng ký thành công!</h2>
        <p className="text-sm text-muted">
          Vui lòng chuyển khoản để xác nhận suất tham dự
        </p>
      </div>

      {qrUrl ? (
        <div className="rounded-xl border border-white/7 bg-surface p-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt="Mã VietQR thanh toán"
            className="w-full max-w-[260px] mx-auto rounded-lg"
          />
          <div className="mt-3">
            <p className="text-accent font-black text-xl">{formatVND(amount)}</p>
            <p className="text-xs text-muted mt-1">
              Nội dung CK:{' '}
              <span className="text-white font-medium">{noteText}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 mb-4 text-sm text-left">
          <p className="text-yellow-400 font-bold mb-2">Thông tin thanh toán</p>
          <p className="text-white/80">
            Vui lòng liên hệ admin để được hướng dẫn chuyển khoản:
          </p>
          <p className="text-accent font-black text-lg mt-2">0914 859 927</p>
          <p className="text-muted text-xs mt-1">
            Nội dung CK: <span className="text-white">{noteText}</span>
          </p>
        </div>
      )}

      <div className="rounded-xl border border-white/7 bg-surface p-4 text-sm text-left space-y-2 mb-4">
        <div className="flex justify-between gap-4">
          <span className="text-muted shrink-0">VĐV đăng ký</span>
          <span className="font-semibold text-right">{playerName}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted shrink-0">Nội dung thi đấu</span>
          <span className="font-semibold text-right">{eventName}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted shrink-0">Phí tham dự</span>
          <span className="text-accent font-black">{formatVND(amount)}</span>
        </div>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        Admin sẽ xác nhận trong vòng <strong className="text-white">24h</strong> sau khi
        nhận được chuyển khoản. Mọi thắc mắc liên hệ{' '}
        <a href="tel:0914859927" className="text-accent">0914 859 927</a>.
      </p>
    </div>
  );
}
