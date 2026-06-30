import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, Timestamp,
  runTransaction, serverTimestamp, addDoc, QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Court, Booking, Player, Tournament, TournamentOS, EventOS, RegistrationOS, GroupOS, MatchOS } from '@/types';

// ─── COURTS ────────────────────────────────────────────────────────────────
export async function getCourts(): Promise<Court[]> {
  const snap = await getDocs(query(collection(db, 'courts'), orderBy('position')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Court));
}

// ─── BOOKINGS ───────────────────────────────────────────────────────────────
export async function getBookingsByDate(courtId: string, date: string): Promise<Booking[]> {
  const snap = await getDocs(query(
    collection(db, 'bookings'),
    where('courtId', '==', courtId),
    where('date',    '==', date),
    where('status',  'not-in', ['cancelled'])
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Booking));
}

export async function createBooking(data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, 'bookings'), {
    ...data, status: 'pending', createdAt: now, updatedAt: now,
  });
  return ref.id;
}

export async function updateBookingStatus(
  bookingId: string,
  status: Booking['status'],
  extra: Record<string, unknown> = {}
): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), {
    status, ...extra, updatedAt: new Date().toISOString(),
  });
}

// ─── PLAYERS ────────────────────────────────────────────────────────────────
export async function getPlayers(activeOnly = true): Promise<Player[]> {
  const constraints: QueryConstraint[] = [orderBy('elo', 'desc')];
  if (activeOnly) constraints.unshift(where('isActive', '==', true));
  const snap = await getDocs(query(collection(db, 'players'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Player));
}

// ─── TOURNAMENTS ─────────────────────────────────────────────────────────────
export async function getTournaments(status?: Tournament['status']): Promise<Tournament[]> {
  const constraints: QueryConstraint[] = [orderBy('date', 'desc')];
  if (status) constraints.unshift(where('status', '==', status));
  const snap = await getDocs(query(collection(db, 'tournaments'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Tournament));
}

// ─── TOURNAMENT OS (new admin schema) ──────────────────────────────────────────

export async function getTournamentsOS(): Promise<TournamentOS[]> {
  const snap = await getDocs(collection(db, 'tournaments'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as TournamentOS))
    .filter(t => t.status !== 'draft')
    .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
}

export async function getTournamentOS(id: string): Promise<TournamentOS | null> {
  const snap = await getDoc(doc(db, 'tournaments', id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as TournamentOS) : null;
}

export async function getAllEventsOS(): Promise<EventOS[]> {
  const snap = await getDocs(collection(db, 'events'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as EventOS));
}

export async function getEventsByTournament(tournamentId: string): Promise<EventOS[]> {
  const snap = await getDocs(query(
    collection(db, 'events'),
    where('tournament_id', '==', tournamentId)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as EventOS));
}

export async function getMatchesByEventIds(eventIds: string[]): Promise<MatchOS[]> {
  if (!eventIds.length) return [];
  const snap = await getDocs(query(
    collection(db, 'matches'),
    where('event_id', 'in', eventIds)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as MatchOS));
}

export async function getRegistrationsByEventIds(eventIds: string[]): Promise<RegistrationOS[]> {
  if (!eventIds.length) return [];
  const snap = await getDocs(query(
    collection(db, 'registrations'),
    where('event_id', 'in', eventIds)
  ));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as RegistrationOS));
  return all.filter(r => r.status === 'confirmed');
}

export async function getGroupsByEventIds(eventIds: string[]): Promise<GroupOS[]> {
  if (!eventIds.length) return [];
  const snap = await getDocs(query(
    collection(db, 'groups'),
    where('event_id', 'in', eventIds)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as GroupOS));
}

export async function createRegistrationOS(
  data: Omit<RegistrationOS, 'id'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'registrations'), data);
  return ref.id;
}
