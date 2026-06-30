import type { Metadata } from 'next';
import BookingPage from '@/components/booking/BookingPage';

export const metadata: Metadata = {
  title: 'Đặt sân Pickleball — AMZ Pickleball',
  description: 'Đặt sân Pickleball trực tuyến tại AMZ Pickleball, 179 Thống Nhất TP.HCM. 8 sân tiêu chuẩn thi đấu.',
};

export default function DatSanPage() {
  return <BookingPage />;
}
