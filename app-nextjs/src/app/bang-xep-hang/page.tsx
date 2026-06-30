import type { Metadata } from 'next';
import LeaderboardPage from '@/components/LeaderboardPage';

export const metadata: Metadata = {
  title: 'Bảng Xếp Hạng ELO — AMZ Pickleball',
  description: 'Bảng xếp hạng ELO vận động viên Pickleball tại AMZ Pickleball Club.',
};

export default function BangXepHangPage() {
  return <LeaderboardPage />;
}
