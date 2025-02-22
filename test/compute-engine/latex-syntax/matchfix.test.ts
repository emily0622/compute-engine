import { latex, check, engine } from '../../utils';

describe('MATCHFIX', () => {
  test('\\lbrack\\rbrack', () =>
    expect(check('\\lbrack\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List"]
      ["List"]
    `));

  test('\\lbrack a\\rbrack', () =>
    expect(check('\\lbrack a\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List", "a"]
      ["List", "a"]
    `));

  test('\\lbrack a, b\\rbrack', () =>
    expect(check('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(`
      latex     = ["List", "a", "b"]
      ["List", "a", "b"]
    `));

  test('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      latex     = ["List", "a", ["List", "b", "c"]]
      ["List", "a", ["List", "b", "c"]]
    `));

  test('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack', () =>
    expect(check('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack'))
      .toMatchInlineSnapshot(`
      latex     = ["Sin", ["List", "a", ["List", "b", "c"]]]
      box       = ["Sin", ["List", "a", ["List", "b", "c"]]]
      evaluate  = ["List", ["Sin", "a"], ["List", ["Sin", "b"], ["Sin", "c"]]]
    `));
});

describe('MATCHFIX serialize', () => {
  test('[List]', () =>
    expect(latex(['List'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack\\bigr\\rbrack`
    ));

  test('[List, "a"]', () =>
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a\\bigr\\rbrack`
    ));

  test(`['List', 'a', 'b']`, () =>
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a, b\\bigr\\rbrack`
    ));

  test(`['List', 'a', ['List', 'b', 'c']`, () =>
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `\\bigl\\lbrack a, \\bigl\\lbrack b, c\\bigr\\rbrack\\bigr\\rbrack`
    ));
});

describe('MATCHFIX synonyms', () => {
  // A given matchfix operators has automatic synonyms:
  // () -> \left(\right)
  //    -> \bigl(\bigr)
  //    -> \lparen\rparen
  //    -> etc...

  test('(a, b, c)', () =>
    expect(check(`(a, b, c)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));

  test('\\left(a, b, c\\right)', () =>
    expect(check(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));
  test('\\bigl(a, b, c\\bigr)', () =>
    expect(check(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));
  test('\\big(a, b, c\\big)', () =>
    expect(check(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));
  test('\\lparen a, b, c\\rparen', () =>
    expect(check(`\\lparen a, b, c\\rparen`)).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));
  test('\\left\\lparen a, b, c\\right\\rparen', () =>
    expect(check(`\\left\\lparen a, b, c\\right\\rparen`))
      .toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      evaluate  = ["Triple", "a", "b", "c"]
    `));
});

describe('MATCHFIX abs and norm', () => {
  test('1+|a|+2', () =>
    expect(check('1+|a|+2')).toMatchInlineSnapshot(`
      latex     = ["Add", 1, ["Abs", "a"], 2]
      box       = ["Add", ["Abs", "a"], 1, 2]
      simplify  = ["Add", ["Abs", "a"], 3]
    `));

  test('|(1+|a|+2)|', () =>
    expect(check('|(1+|a|+2)|')).toMatchInlineSnapshot(`
      latex     = ["Abs", ["Delimiter", ["Sequence", ["Add", 1, ["Abs", "a"], 2]]]]
      box       = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ["Abs", ["Add", ["Abs", "a"], 3]]
    `));

  test('|1+|a|+2|', () =>
    expect(check('|1+|a|+2|')).toMatchInlineSnapshot(`
      latex     = ["Abs", ["Add", 1, ["Abs", "a"], 2]]
      box       = ["Abs", ["Add", ["Abs", "a"], 1, 2]]
      simplify  = ["Abs", ["Add", ["Abs", "a"], 3]]
    `));

  test('||a||', () =>
    expect(check('||a||')).toMatchInlineSnapshot(`
      latex     = ["Norm", "a"]
      ["Norm", "a"]
    `));
  test('||a||+|b|', () =>
    expect(check('||a||+|b|')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Norm", "a"], ["Abs", "b"]]
      ["Add", ["Abs", "b"], ["Norm", "a"]]
    `));
});

describe('MATCHFIX invalid', () => {
  test('( // missing closing fence', () =>
    expect(check('(')).toMatchInlineSnapshot(`
      latex     = ["Error", ["ErrorCode", "'unexpected-token'", "'('"]]
      ["Error", ["ErrorCode", "'unexpected-token'", "'('"]]
    `));
  test(') // missing opening fence', () => {
    expect(check(')')).toMatchInlineSnapshot(`
      latex     = ["Error", ["ErrorCode", "'unexpected-token'", "')'"]]
      ["Error", ["ErrorCode", "'unexpected-token'", "')'"]]
    `);
  });

  test('-( // missing closing fence', () => {
    expect(engine.parse('-(').json).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Negate", ["Error", "'missing'"]],
        ["Error", ["ErrorCode", "'unexpected-token'", "'('"]]
      ]
    `);
  });

  test('(3+x // missing closing fence', () => {
    expect(engine.parse('(3+x').json).toMatchInlineSnapshot(
      `["Error", ["ErrorCode", "'unexpected-token'", "'('"]]`
    );
  });
});
