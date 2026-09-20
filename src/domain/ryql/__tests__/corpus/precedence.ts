/**
 * Corpus item 4 (spec 02 §10): the precedence table. Twenty queries mixing AND, OR, NOT
 * and `->`, each with the tree Reqforge must build, printed with every implied
 * parenthesis (RD-018).
 */
export const PRECEDENCE_CASES: ReadonlyArray<{ query: string; tree: string }> = [
  { query: "a = '1' AND b = '2'", tree: "(a = '1' AND b = '2')" },
  { query: "a = '1' OR b = '2'", tree: "(a = '1' OR b = '2')" },
  { query: "a = '1' AND b = '2' AND c = '3'", tree: "((a = '1' AND b = '2') AND c = '3')" },
  { query: "a = '1' OR b = '2' OR c = '3'", tree: "((a = '1' OR b = '2') OR c = '3')" },
  { query: "a = '1' AND b = '2' OR c = '3'", tree: "((a = '1' AND b = '2') OR c = '3')" },
  { query: "a = '1' OR b = '2' AND c = '3'", tree: "(a = '1' OR (b = '2' AND c = '3'))" },
  { query: "(a = '1' OR b = '2') AND c = '3'", tree: "((a = '1' OR b = '2') AND c = '3')" },
  { query: "NOT a = '1' AND b = '2'", tree: "(NOT a = '1' AND b = '2')" },
  { query: "NOT (a = '1' AND b = '2')", tree: "NOT (a = '1' AND b = '2')" },
  { query: "NOT NOT a = '1'", tree: "NOT NOT a = '1'" },
  { query: "NOT a = '1' OR b = '2'", tree: "(NOT a = '1' OR b = '2')" },
  { query: "a = '1' AND NOT b = '2'", tree: "(a = '1' AND NOT b = '2')" },
  { query: "to -> key = 'X' AND b = '2'", tree: "(to -> key = 'X' AND b = '2')" },
  { query: "to -> (key = 'X' AND b = '2')", tree: "to -> (key = 'X' AND b = '2')" },
  { query: "NOT to -> key = 'X'", tree: "NOT to -> key = 'X'" },
  { query: "from -> to -> key = 'X'", tree: "from -> to -> key = 'X'" },
  { query: "a IS NULL AND b IS NOT NULL", tree: '(a IS NULL AND b IS NOT NULL)' },
  { query: "a IN ('1', '2') OR b = '3'", tree: "(a IN ('1', '2') OR b = '3')" },
  { query: "a NOT IN ('1') AND NOT b = '2'", tree: "(a NOT IN ('1') AND NOT b = '2')" },
  {
    query: "a = '1' AND (b = '2' OR c = '3') AND NOT d = '4'",
    tree: "((a = '1' AND (b = '2' OR c = '3')) AND NOT d = '4')",
  },
];
