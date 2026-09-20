import { describe, expect, it } from 'vitest';
import { RqlSyntaxError } from '../errors';
import { tokenise } from '../lexer';

const values = (source: string) => tokenise(source).slice(0, -1).map((token) => `${token.type}:${token.value}`);

describe('lexer (spec 02 §2, RD-019)', () => {
  it('tokenises fields, operators and values', () => {
    expect(values("key = 'IG-1'")).toEqual(['IDENT:key', 'OPERATOR:=', 'STRING:IG-1']);
    expect(values('@Property > 5')).toEqual(['QUALIFIER:Property', 'OPERATOR:>', 'NUMBER:5']);
    expect(values('baseline = -2')).toEqual(['IDENT:baseline', 'OPERATOR:=', 'NUMBER:-2']);
  });

  it('accepts curly and double quotes and normalises them', () => {
    expect(values('key = ‘IG-1’')).toEqual(['IDENT:key', 'OPERATOR:=', 'STRING:IG-1']);
    expect(values('key = "IG-1"')).toEqual(['IDENT:key', 'OPERATOR:=', 'STRING:IG-1']);
  });

  it("decodes \\' and \\\\ but leaves \\% for the compiler", () => {
    expect(tokenise("text = 'it\\'s'")[2]!.value).toBe("it's");
    expect(tokenise("text = 'a\\\\b'")[2]!.value).toBe('a\\b');
    // `\%` must survive: under ~ it means a literal percent sign (spec 02 §2.2).
    expect(tokenise("text ~ '100\\%'")[2]!.value).toBe('100\\%');
  });

  it('reads qualified names with backslash escapes and the quoted form', () => {
    expect(tokenise('@Main\\ Category = 1')[0]!.value).toBe('Main Category');
    expect(tokenise("@'Main Category' = 1")[0]!.value).toBe('Main Category');
    expect(tokenise("to@refines = 'X'").map((token) => token.value)).toEqual(['to', 'refines', '=', 'X', '']);
  });

  it('accepts both arrow forms', () => {
    expect(values("to -> key = 'X'")[1]).toBe('OPERATOR:->');
    expect(values("to → key = 'X'")[1]).toBe('OPERATOR:->');
  });

  it('reports an unterminated string with its offset', () => {
    try {
      tokenise("key = 'IG-1");
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RqlSyntaxError);
      const { diagnostic } = error as RqlSyntaxError;
      expect(diagnostic.code).toBe('UNTERMINATED_STRING');
      expect(diagnostic.offset).toBe(6);
    }
  });

  it('records offsets so the editor can underline', () => {
    const tokens = tokenise("status = 'ACTIVE'");
    expect(tokens[0]).toMatchObject({ offset: 0, length: 6 });
    expect(tokens[2]).toMatchObject({ offset: 9, length: 8 });
  });
});
