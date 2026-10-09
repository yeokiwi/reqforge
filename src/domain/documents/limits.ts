// Hard limits for pages, versions, attachments and presence. One table so the API, the
// editor and the tests read the same numbers; the database CHECK constraints in
// prisma/migrations/20261009120000_documents restate the ones it can enforce.

const MIB = 1024 * 1024;

// spec: docs/specs/07-permissions-and-limits.md section 4 (RD-056, RD-058, RD-062, RD-063)
export const LIMITS = {
  /** Page title, 1–255 code points after trimming and NFC. 07 §4 "Page title", RD-056, RD-063. */
  titleMax: 255,
  /** Change note (`What did you change?`), at most 500 code points. 07 §4 "Change note", RD-063. */
  messageMax: 500,
  /** Serialised ProseMirror JSON, in bytes. 07 §4 "Page content", RD-063, 03 §1.4. */
  contentMaxBytes: 5 * MIB,
  /** Nesting depth of the content tree. 07 §4 "Page content", RD-063, 03 §1.4. */
  contentMaxDepth: 64,
  /** One attachment, in bytes (the Attachment_size_matches CHECK says 10485760). 07 §4, RD-058. */
  attachmentMaxBytes: 10 * MIB,
  /** An open editor sends a presence heartbeat this often. RD-062. */
  presenceHeartbeatMs: 15_000,
  /** A user counts as present for this long after their last heartbeat. RD-062. */
  presenceWindowMs: 45_000,
} as const;
