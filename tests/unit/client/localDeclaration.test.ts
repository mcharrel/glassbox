import { localDeclaration } from '../../../src/client/diff/localDeclaration.js';
const lines = (text: string) => text.split('\n').map((content, i) => ({ line: i + 1, content }));
describe('local variable navigation', () => {
  it.each(['const value = 1;', 'let value = 1;', 'var value int', 'value := 1', 'private final String value = "x";', 'Map<String, Object> value = create();'])('finds %s', declaration => {
    expect(localDeclaration(lines(declaration + '\nuse(value);'), 'value', 2)).toBe(1);
  });
  it('prefers the current scope and ignores closed sibling scopes', () => {
    const code = lines('class Example {\nint value = 1;\nvoid first() {\nint value = 2;\nuse(value);\n}\nvoid second() {\nuse(value);\n}\n}');
    expect(localDeclaration(code, 'value', 5)).toBe(4);
    expect(localDeclaration(code, 'value', 8)).toBe(2);
  });
  it('finds typed parameters', () => {
    expect(localDeclaration(lines('void run(String value) {\nuse(value);\n}'), 'value', 2)).toBe(1);
  });
  it('does not interpret comments, strings, uses or later declarations as definitions', () => {
    expect(localDeclaration(lines('// int value = 2;\n"const value = 3";\nreturn value;\nint value = 4;'), 'value', 3)).toBeNull();
    expect(localDeclaration([], 'value', 3)).toBeNull();
  });
});
