import { parse } from '../../utils';

describe('STEFNOTCH #9', () => {
  test('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x', () => {
    expect(
      parse('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x')
    ).toMatchInlineSnapshot(`["Integrate", ["Multiply", 3, "x"], "Nothing"]`);
  });
});

describe('STEFNOTCH #10', () => {
  test('1/ \\displaystyle \\left(\\sin^{-1}\\left(x\\right)\\right)^{\\prime}', () => {
    expect(
      parse(
        '\\displaystyle \\left(\\sin^{-1}\\left(x\\right)\\right)^{\\prime}'
      )
    ).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'\\left('"]]`
    );
  });

  test('2/ 1^{\\sin(x)}', () => {
    expect(parse('1^{\\sin(x)}')).toMatchInlineSnapshot(
      `["Power", 1, ["Sin", "x"]]`
    );
  });

  test('3/ 3\\text{hello}6', () => {
    expect(parse('3\\text{hello}6')).toMatchInlineSnapshot(
      `["Triple", 3, "'hello'", 6]`
    );
  });

  test('4/ \\color{red}3', () => {
    expect(parse('\\color{red}3')).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\color'"],
        ["LatexString", "'\\color{red}'"]
      ]
    `);
  });

  test('5/ \\ln(3)', () => {
    expect(parse('\\ln(3)')).toMatchInlineSnapshot(`["Ln", 3]`);
  });

  test('6/ f:[a,b]\\to R', () => {
    expect(parse('f:[a,b]\\to R ')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "f",
        ["Error", ["ErrorCode", "'unexpected-token'", "':'"]]
      ]
    `);
  });

  test('7/ \\lim_{n\\to\\infty}3', () => {
    expect(parse('\\lim_{n\\to\\infty}3')).toMatchInlineSnapshot(
      `["Limit", ["Function", 3, "n"], {num: "+Infinity"}]`
    );
  });

  test('8/ \\begin{cases} 3 & x < 5 \\\\ 7 & \\text{else} \\end{cases}', () => {
    expect(
      parse('\\begin{cases} 3 & x < 5 \\\\ 7 & \\text{else} \\end{cases}')
    ).toMatchInlineSnapshot(`["Which", ["Less", "x", 5], 3, "True", 7]`);
  });
});

describe('STEFNOTCH #12', () => {
  test('1/ e^{i\\pi\\text{nope!?\\lparen sum}}', () => {
    expect(parse('e^{i\\pi\\text{nope!?\\lparen sum}}')).toMatchInlineSnapshot(`
      [
        "Power",
        "ExponentialE",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Tuples"],
          ["Triple", "ImaginaryUnit", "Pi", "'nope!?\\lparensum'"]
        ]
      ]
    `);
  });
});

describe('STEFNOTCH #13', () => {
  test('1/ Q(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil', () => {
    expect(
      parse('Q(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil')
    ).toMatchInlineSnapshot(`
      [
        "Assign",
        "Q",
        [
          "Function",
          ["Ceil", ["Divide", 4, ["Power", "epsilonSymbol", 2]]],
          "epsilonSymbol"
        ]
      ]
    `);
  });

  test('2/ x_{1,2}=1,2', () => {
    expect(parse('x_{1,2}=1,2')).toMatchInlineSnapshot(`
      [
        "Delimiter",
        [
          "Sequence",
          [
            "Equal",
            [
              "Error",
              "'expected-pure-expression'",
              ["Subscript", "x", ["Delimiter", ["Sequence", 1, 2], "','"]]
            ],
            1
          ],
          2
        ],
        "','"
      ]
    `);
  }); // @fixme unclear what the right answer is

  test('3/  \\{1,2\\}', () => {
    expect(parse('\\{1,2\\}')).toMatchInlineSnapshot(`["Set", 1, 2]`);
  });

  test('4/ \\[1,2\\]', () => {
    expect(parse('[1,2]')).toMatchInlineSnapshot(
      `["Error", ["ErrorCode", "'unexpected-token'", "'['"]]`
    );
  });

  test('5/ \\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}', () => {
    expect(parse('\\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}'))
      .toMatchInlineSnapshot(`
      [
        "Equivalent",
        ["Divide", 2, ["Sqrt", "n"]],
        ["Less", ["Divide", 5, ["Square", "n"]], "n"]
      ]
    `);
  });

  test('6/ |a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0', () => {
    expect(parse('|a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0'))
      .toMatchInlineSnapshot(`
      [
        "Implies",
        ["LessEqual", ["Abs", "a_n"], ["Divide", 2, ["Sqrt", "n"]]],
        [
          "Equal",
          ["Error", "'expected-pure-expression'", ["To", "a_n", 0]],
          0
        ]
      ]
    `);
  });

  // Note that the (\\mod) applies to the entire equation, not just the 11
  test('7/ 26\\equiv11(\\pmod5)', () => {
    expect(parse('3\\equiv5\\pmod7')).toMatchInlineSnapshot(
      `["Congruent", 3, 5, 7]`
    );
  });

  test('8/ a={displaystyle lim_{n\\toinfin}a_n}', () => {
    expect(parse('a={\\displaystyle \\lim_{n\\to \\infty}a_n}'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        "a",
        [
          "Triple",
          [
            "Error",
            "'expected-closing-delimiter'",
            ["LatexString", "'{\\displaystyle\\lim_{n\\to\\infty}'"]
          ],
          "a_n",
          ["Error", "'unexpected-closing-delimiter'", ["LatexString", "'}'"]]
        ]
      ]
    `);
  });

  test('9/  \\forall x\\in\\C^2:|x|<0', () => {
    expect(parse('\\forall x\\in\\C^2:|x|<0')).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\forall'"],
        ["LatexString", "'\\forall'"]
      ]
    `);
  });

  test('10/ \\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a', () => {
    expect(
      parse(
        '\\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a'
      )
    ).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\forall'"],
        ["LatexString", "'\\forall'"]
      ]
    `);
  });
});
