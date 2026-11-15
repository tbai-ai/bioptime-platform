/* The payload shapes the part B1 admin screens read, as the API presents them (apps/api/src/domain/*.ts; the fields
   the portal uses). Optional where a restricted view may strip a key (apps/api/src/auth/fieldPolicy.ts). */

export type Appointment = { id: string; memberId: string; memberName: string; coachId: string | null; coachName: string | null; kind: string; status: string; startAt: string; endAt: string; meetingLink?: string | null; note?: string | null; memberNote?: string | null; consumesEntitlement?: boolean };

export type Conversation = { id: string; memberId: string; memberName: string; coachId: string; coachName: string; lastMessageAt: string | null; lastBody: string | null; unread: number };
export type Attachment = { id: string; name: string; mime: string; bytes: number; kind: 'image' | 'pdf' };
export type Message = { id: string; senderId: string; mine: boolean; body: string | null; createdAt: string; readAt?: string | null; attachments?: Attachment[] };
export type Thread = { conversation: { id: string; memberId: string; coachId: string }; items: Message[]; nextCursor?: string | null };

export type LabTest = { id: string; vendorTestId: string; kind: string; name: string; description?: string; priceInr: number | null; fastingHours: number; turnaround: string; markers?: number; preparation?: string; hidden: boolean };
export type ReportValue = { marker_key: string | null; vendor_test_id?: string | null; label: string; value: string; units: string | null; range_low: number | null; range_high: number | null; matched_range?: string | null; flag: string | null; unmapped?: boolean };
export type Report = { id: string; bookingId: string; reference: string; memberId: string; memberName: string | null; test: LabTest | null; collectedAt: string; deliveredAt: string; released: boolean; releasedAt: string | null; reviewed: boolean; reviewedAt: string | null; reviewerName: string | null; reviewerKind: 'coach' | 'team'; coachNote: string | null; flagged: string[]; valuesStatus: 'pending' | 'ready' | 'failed' | string; values: ReportValue[]; hasFile: boolean; provenance: string; simulated: boolean; coachCanReview?: boolean };
export type Booking = { id: string; reference: string; memberId: string; memberName: string; test: LabTest | null; status: string; statusLabel?: string; slotAt: string; vendorOrderId: string | null; vendorStatus: string | null; flag: string | null; simulated?: boolean };

export type Task = { id: string; kind: string; status: string; title: string; detail: string | null; ref_type: string | null; ref_id: string | null; owner_id: string | null; resolution: string | null; created_at: string; owner_name: string | null };
export type AuditRow = { id: string; actor_id: string | null; actor_role: string | null; action: string; target_type: string | null; target_id: string | null; reason: string | null; at: string; actor_name: string | null };
export type Enquiry = { id: string; name: string; email: string; purpose: string; message: string; status: 'new' | 'in_progress' | 'closed' | string; created_at: string; handled_by_name?: string | null };
export type OutboxRow = { id: string; channel: string; to_address: string; subject: string | null; body: string | null; status: string; created_at: string };
export type JobRun = { id: string; job: string; started_at: string; finished_at: string | null; ok: number | boolean | null; detail: string | null };
export type DeadLetter = { id: string; type: string; aggregate_type: string | null; aggregate_id: string | null; attempts: number; last_error: string | null };

export type Overview = { demo: boolean; members: { total: number; active: number; onboarding: number; new30d: number }; orders: { new30d: number; pendingPayment: number; activated30d: number }; revenue: { verifiedInr30d: number; verifiedInrAll: number; refundedInr: number; note: string }; programmes: { active: number; endingIn7d: number }; assignments: { unassigned: number; exceptions: number }; coaches: { active: number; available: number; utilisationPct: number }; appointments: { upcoming7d: number; requested: number }; bloodwork: Record<string, number>; reportsAwaitingReview: number; exceptions: { open: number; byKind: Record<string, number> }; customPlans: Record<string, number>; enquiries: { new: number }; ordersByWeek: Array<{ week: string; n: number; inr: number }>; generatedAt: string };
export type ReportRun = { name: string; title: string; note: string; from: string; to: string; columns: string[]; rows: Array<Record<string, unknown>>; demo: boolean };

export type Notification = { id: string; category?: string | null; title: string; body?: string | null; created_at: string; read_at?: string | null };
