import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'vietnamese'], display: 'swap' });

export const metadata: Metadata = {
  title:       'AMZ Pickleball — Đặt sân & Quản lý',
  description: 'Hệ thống đặt sân, quản lý hội viên và giải đấu Pickleball tại AMZ Pickleball, 179 Thống Nhất, TP.HCM',
  keywords:    ['pickleball', 'đặt sân', 'AMZ Pickleball', 'TP.HCM'],
  openGraph: {
    title:       'AMZ Pickleball',
    description: 'Đặt sân Pickleball trực tuyến tại TP.HCM',
    url:         'https://amzpickleball.vn',
    siteName:    'AMZ Pickleball',
    locale:      'vi_VN',
    type:        'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="scroll-smooth">
      <body className={`${inter.className} bg-bg text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
