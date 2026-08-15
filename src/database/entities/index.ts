import {
  Consent,
  Elder,
  Guardian,
  GuardianLink,
  LinkInvite,
  PersonaConfig,
  PersonaConfigHistory,
} from './identity.entities';
import { LifeSignal, MemoryItem, Message, SignalReview } from './conversation.entities';
import {
  AlertAck,
  AlertSignalLink,
  BaselineSnapshot,
  PatternAlert,
  WeeklyDigest,
} from './pattern.entities';
import {
  AuditLog,
  CheckupEligibility,
  CommunityActivityRecord,
  GovHealthRecord,
  MedicalJourney,
  MedicationItem,
  Notification,
} from './medical.entities';

export * from './identity.entities';
export * from './conversation.entities';
export * from './pattern.entities';
export * from './medical.entities';

/** TypeORM 註冊用。新增 entity 時務必加進來，否則 repository 注入會失敗。 */
export const ALL_ENTITIES = [
  // §2.1 身分與關係
  Elder,
  Guardian,
  GuardianLink,
  LinkInvite,
  Consent,
  PersonaConfig,
  PersonaConfigHistory,
  // §2.2 對話與訊號
  Message,
  LifeSignal,
  SignalReview,
  MemoryItem,
  // §2.3 Baseline 與 Pattern
  BaselineSnapshot,
  PatternAlert,
  AlertSignalLink,
  AlertAck,
  WeeklyDigest,
  // §2.4 醫療、公部門資料與通知
  MedicalJourney,
  MedicationItem,
  GovHealthRecord,
  CheckupEligibility,
  CommunityActivityRecord,
  Notification,
  AuditLog,
];
