-- Round 6 (learning): when a coach's assignment began, so a coach without the member's sharing consent sees only what
-- happened from then on.
--
-- A course a member chose themselves (or got with their package) is theirs; their coach sees it only while the member
-- shares with their coach (coach_sharing). A coach may still assign that course: the enrolment becomes the coach's
-- assignment, and from assigned_at on its progress is visible to the coach as every coach-assigned course is. What the
-- member did before assigned_at (when they enrolled, the lessons they finished, whether they had finished or left the
-- course) stays visible only while they share. For an enrolment a coach's assignment created, assigned_at equals
-- enrolled_at, so nothing is hidden.
--
-- Existing coach-assigned rows: the first assignment that took over the member's own enrolment (the course.assign audit
-- row naming a previous source 'self' or 'package'), otherwise the enrolment time. Additive only.
ALTER TABLE course_enrollments ADD COLUMN assigned_at TEXT;
UPDATE course_enrollments
   SET assigned_at = COALESCE(
     (SELECT MIN(a.at) FROM audit_events a
       WHERE a.action = 'course.assign' AND a.target_type = 'course_enrollment' AND a.target_id = course_enrollments.id
         AND json_valid(a.data) AND json_extract(a.data, '$.previous.source') IN ('self', 'package')),
     enrolled_at)
 WHERE source = 'coach_assigned' AND assigned_at IS NULL;
