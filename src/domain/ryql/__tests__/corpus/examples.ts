/**
 * Corpus item 1 (spec 02 §10): every example query from research §3.8, verbatim.
 * `expect` says what the front end must do with it:
 *  - 'parses'          — valid RQL
 *  - 'warns'           — parses with a warning (deprecated alias, ambiguous precedence)
 *  - 'not-implemented' — parses, then reports NOT_IMPLEMENTED (RD-022, the testing module)
 */
export type CorpusExample = { query: string; expect: 'parses' | 'warns' | 'not-implemented' };

export const RESEARCH_EXAMPLES: readonly CorpusExample[] = [
  { query: "key = 'IG-1'", expect: 'parses' },
  { query: "key ~ 'IG-%'", expect: 'parses' },
  { query: "key_case_sensitive ~ 'REQ_Work_%'", expect: 'parses' },
  { query: "key ~ 'REQ-%' and not key_case_sensitive ~ 'REQ-%'", expect: 'parses' },
  { query: "text ~ '% something'", expect: 'parses' },
  { query: 'page = 467382', expect: 'warns' },
  { query: 'pageHistory ~ 123', expect: 'warns' },
  { query: "jira = 'JRA-21'", expect: 'not-implemented' },
  { query: "jira@implements = 'JRA-21'", expect: 'not-implemented' },
  { query: "NOT (jira ~ '%')", expect: 'not-implemented' },
  { query: 'JIRA IS NULL', expect: 'not-implemented' },
  { query: "@Category = 'Functional'", expect: 'parses' },
  { query: "@status = 'Approved'", expect: 'parses' },
  { query: "@Status IN ('New', 'In progress')", expect: 'parses' },
  { query: "@Main\\ Category = 'Functional'", expect: 'parses' },
  { query: "@ReleaseDate > '2026-06-30'", expect: 'parses' },
  { query: '@Property > 5', expect: 'parses' },
  { query: "ext@Category = 'Functional'", expect: 'parses' },
  { query: "TO = 'REQ-001'", expect: 'parses' },
  { query: "FROM = 'REQ-001'", expect: 'parses' },
  { query: "FROM ~ 'REQ-%'", expect: 'parses' },
  { query: "FROM@refines = 'REQ-001'", expect: 'parses' },
  { query: "isModified('7')", expect: 'parses' },
  { query: 'baseline = 3', expect: 'parses' },
  { query: 'baseline was 3', expect: 'parses' },
  { query: 'baseline = 4 and baseline was 3', expect: 'parses' },
  { query: "baseline = 'My Baseline'", expect: 'parses' },
  { query: "ruleStatus = 'false'", expect: 'parses' },
  { query: "hasLastTest('%Success%')", expect: 'not-implemented' },
  { query: "excel = '48496653'", expect: 'not-implemented' },
  {
    query: "key ~ 'FN%' AND NOT (@Property = 'Functional' AND @Component = 'Core')",
    expect: 'parses',
  },
];

/** Cloud's traversal operator, folded in by spec 02. */
export const TRAVERSAL_EXAMPLES: readonly CorpusExample[] = [
  { query: "to -> key = 'BR-001'", expect: 'parses' },
  { query: "to@refines -> (@Category = 'Safety' OR @Category = 'Security')", expect: 'parses' },
  { query: "from -> to -> key = 'BR-001'", expect: 'parses' },
  { query: "to → key = 'BR-001'", expect: 'parses' },
];
