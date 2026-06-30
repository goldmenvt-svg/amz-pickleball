import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <p className="text-7xl font-black text-white/10 mb-4">404</p>
      <h1 className="text-2xl font-black mb-2">Trang không tồn tại</h1>
      <p className="text-muted text-sm mb-6">Đường dẫn này không còn hoạt động hoặc chưa được triển khai.</p>
      <Link href="/dat-san" className="bg-accent text-black font-bold px-5 py-2.5 rounded-lg hover:bg-accent/90 transition-colors text-sm">
        Về trang đặt sân
      </Link>
    </div>
  );
}
