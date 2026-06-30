import type { Metadata } from 'next';
import TournamentsPage from '@/components/TournamentsPage';

export const metadata: Metadata = {
  title: 'Giải Đấu — AMZ Pickleball',
  description: 'Lịch thi đấu, đăng ký giải đấu Pickleball tại AMZ Pickleball Club TP.HCM.',
};

export default function GiaiDauPage() {
  return <TournamentsPage />;
}
