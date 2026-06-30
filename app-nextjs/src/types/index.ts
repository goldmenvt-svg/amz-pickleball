export type UserRole = 'admin' | 'staff' | 'member' | 'guest';

export interface User {
  uid:       string;
  role:      UserRole;
  name:      string;
  phone:     string;
  email:     string;
  avatar:    string;
  isActive:  boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id:          string;
  userId:      string | null;
  name:        string;
  phone:       string;
  email:       string;
  photo:       string;
  duprLevel:   number;
  elo:         number;
  categories:  string[];
  tier:        'Mới' | 'Khá' | 'Giỏi' | 'Chuyên';
  note:        string;
  isActive:    boolean;
  stats: {
    totalMatches:       number;
    wins:               number;
    losses:             number;
    tournamentsPlayed:  number;
    points:             number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Court {
  id:           string;
  name:         string;
  type:         'indoor' | 'outdoor';
  surface:      string;
  pricePerHour: number;
  amenities:    string[];
  photos:       string[];
  status:       'available' | 'maintenance' | 'closed';
  position:     number;
  createdAt:    string;
  updatedAt:    string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled' | 'completed';

export interface Booking {
  id:            string;
  courtId:       string;
  userId:        string;
  playerName:    string;
  playerPhone:   string;
  date:          string;
  startTime:     string;
  endTime:       string;
  durationHours: number;
  amount:        number;
  status:        BookingStatus;
  paymentId:     string | null;
  note:          string;
  cancelReason:  string;
  confirmedBy:   string | null;
  createdAt:     string;
  updatedAt:     string;
}

export type TournamentStatus = 'upcoming' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled';
export type TournamentFormat = 'single_elimination' | 'double_elimination' | 'round_robin';

export interface Tournament {
  id:                    string;
  name:                  string;
  description:           string;
  date:                  string;
  endDate:               string;
  type:                  'internal' | 'inter-club' | 'open';
  format:                TournamentFormat;
  status:                TournamentStatus;
  categories:            string[];
  maxTeamsPerCategory:   number;
  entryFee:              number;
  prize:                 string;
  venue:                 string;
  image:                 string;
  registrationDeadline:  string;
  note:                  string;
  organizer:             string;
  createdAt:             string;
  updatedAt:             string;
}

// ─── TOURNAMENT OS SCHEMA (admin system v2) ──────────────────────────────────

export type EventOSType = 'mens_doubles' | 'womens_doubles' | 'mixed' | 'mens_singles' | 'womens_singles';

export interface TournamentOS {
  id:          string;
  name:        string;
  description: string;
  start_date:  string;
  end_date:    string;
  venue:       string;
  court_count: number;
  status:      'draft' | 'open' | 'ongoing' | 'closed';
  created_at:  string;
}

export interface EventOS {
  id:            string;
  tournament_id: string;
  name:          string;
  event_type:    EventOSType;
  rating_min:    number;
  rating_max:    number;
  max_players:   number;
  entry_fee:     number;
  status:        'open' | 'full' | 'closed';
}

export interface RegistrationOS {
  id:              string;
  event_id:        string;
  player_1_id:     string | null;
  player_2_id:     string | null;
  player_1_name?:  string;
  player_1_phone?: string;
  player_1_email?: string;
  player_2_name?:  string;
  player_2_phone?: string;
  payment_status:  'pending' | 'paid' | 'refunded';
  checkin_status:  'pending' | 'checked_in';
  seed_number:     number;
  status:          'pending' | 'confirmed' | 'rejected' | 'withdrawn';
  source?:         'public' | 'admin';
  created_at:      string;
}

export interface GroupOS {
  id:          string;
  event_id:    string;
  name:        string;
  group_order: number;
}

export interface MatchOS {
  id:             string;
  event_id:       string;
  group_id:       string | null;
  round_type:     'group' | 'quarterfinal' | 'semifinal' | 'final';
  team_a_id:      string;
  team_b_id:      string;
  court_number:   number | null;
  scheduled_time: string | null;
  score_a:        number | null;
  score_b:        number | null;
  winner_id:      string | null;
  status:         'scheduled' | 'ongoing' | 'completed' | 'cancelled';
}

export interface EloHistory {
  id:           string;
  playerId:     string;
  matchId:      string;
  tournamentId: string;
  eloBefore:    number;
  eloAfter:     number;
  delta:        number;
  result:       'win' | 'loss';
  opponent1Id:  string;
  opponent2Id:  string | null;
  createdAt:    string;
}
