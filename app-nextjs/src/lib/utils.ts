import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString('vi-VN');
}

export function validatePhone(phone: string): boolean {
  return /^(03|05|07|08|09)\d{8}$/.test(phone);
}

export function generateTimeSlots(openHour = 5, closeHour = 23): string[] {
  const slots: string[] = [];
  for (let h = openHour; h < closeHour; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`);
    slots.push(`${String(h).padStart(2,'0')}:30`);
  }
  return slots;
}

export function checkTimeOverlap(
  start1: string, end1: string, start2: string, end2: string
): boolean {
  return start1 < end2 && end1 > start2;
}
