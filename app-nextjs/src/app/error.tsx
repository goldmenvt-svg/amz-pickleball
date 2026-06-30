'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <p className="text-5xl mb-4">⚠️</p>
      <h2 className="text-xl font-black mb-2">Có lỗi xảy ra</h2>
      <p className="text-muted text-sm mb-6">{error.message || 'Vui lòng thử lại sau'}</p>
      <button onClick={reset} className="bg-accent text-black font-bold px-5 py-2.5 rounded-lg hover:bg-accent/90 transition-colors text-sm">
        Thử lại
      </button>
    </div>
  );
}
