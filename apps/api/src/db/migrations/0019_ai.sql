-- M11 Coach AI drafting (CAPABILITY_MAP.md 4.11). Depends only on 0001 (users).
--
-- A draft is written for a coach, never for a member: the coach edits and accepts it, then sends it through the existing
-- routes (a message, a plan draft). Nothing here is shown to a member.
-- The context sent to a provider is never stored: input_refs lists the ids of the records it was built from, and
-- context_scope says which sections it held (profile, messages, plan, check-in questions, health detail), never their
-- content. The coach's instructions are not stored either. Drafts are deleted after ai_draft_retention_days (an owner
-- decision; while it is undecided Coach AI refuses every request, so nothing accumulates).
CREATE TABLE ai_drafts (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  member_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('message_reply', 'plan_outline', 'checkin_response', 'meal_plan_outline', 'workout_outline')),
  input_refs TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(input_refs)),
  context_scope TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_scope)),
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ready', 'failed', 'accepted', 'discarded')),
  output TEXT,
  final_text TEXT,
  accepted_at TEXT,
  discarded_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ai_drafts_coach ON ai_drafts (coach_id, created_at);
CREATE INDEX ai_drafts_member ON ai_drafts (member_id, status);
CREATE INDEX ai_drafts_created ON ai_drafts (created_at);
