import type { Metadata } from 'next';
import MemberPage from '@/components/MemberPage';

export const metadata: Metadata = {
  title: 'Hội Viên — AMZ Pickleball',
  description: 'Đăng ký gói hội viên AMZ Pickleball. Ưu đãi sân, giảm giá và nhiều quyền lợi hội viên.',
};

export default function HoiVienPage() {
  return <MemberPage />;
}
