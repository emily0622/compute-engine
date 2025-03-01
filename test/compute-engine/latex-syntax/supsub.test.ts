import { Expression } from '../../../src/math-json/math-json-format';
import { parse, latex, engine } from '../../utils';

describe('POWER', () => {
  test('Power Invalid forms', () => {
    expect(latex(['Power'])).toMatchInlineSnapshot(
      `\\error{\\blacksquare}^{\\error{\\blacksquare}}`
    );
    expect(
      latex(['Power', null as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(
      latex(['Power', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(latex(['Power', 1])).toMatchInlineSnapshot(
      `1^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', NaN])).toMatchInlineSnapshot(
      `\\operatorname{NaN}^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', Infinity])).toMatchInlineSnapshot(
      `\\infty^{\\error{\\blacksquare}}`
    );
  });
});

describe('INVERSE FUNCTION', () => {
  test('Valid forms', () => {
    expect(latex(['Apply', ['InverseFunction', 'Sin']])).toMatchInlineSnapshot(
      `\\arcsin(\\error{\\blacksquare})`
    );
    expect(latex(['Apply', ['InverseFunction', 'f']])).toMatchInlineSnapshot(
      `f^{-1}()`
    );
  });
});

describe('COMPLEX SYMBOLS', () => {
  test('\\mathord{x_{\\mathrm{max}}}', () =>
    expect(
      engine.parse('\\mathord{x_{\\mathrm{max}}}').canonical.toJSON()
    ).toMatchInlineSnapshot(`x_max`));
});

describe('SUPSUB', () => {
  test('Superscript', () => {
    expect(parse('2^2')).toMatchInlineSnapshot(`["Square", 2]`);
    expect(parse('x^t')).toMatchInlineSnapshot(`["Power", "x", "t"]`);
    expect(parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(parse('\\pi^2')).toMatchInlineSnapshot(`["Square", "Pi"]`);
    expect(parse('2^23')).toMatchInlineSnapshot(
      `["Multiply", ["Square", 2], 3]`
    );
    expect(parse('2^\\pi')).toMatchInlineSnapshot(`["Power", 2, "Pi"]`);
    expect(parse('2^\\frac12')).toMatchInlineSnapshot(`["Sqrt", 2]`);
    expect(parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(parse('2^{-2}')).toMatchInlineSnapshot(
      `["Divide", 1, ["Square", 2]]`
    );
    expect(parse('2^3^4')).toMatchInlineSnapshot(
      `["Power", 2, ["List", 3, 4]]`
    );
    expect(parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(parse('12^34.5')).toMatchInlineSnapshot(
      `["Multiply", ["Power", 12, 3], 4.5]`
    );
    expect(parse('x^2')).toMatchInlineSnapshot(`["Square", "x"]`);
    expect(parse('x^{x+1}')).toMatchInlineSnapshot(
      `["Power", "x", ["Add", "x", 1]]`
    );
  });
  test('Subscript', () => {
    expect(parse('x_0')).toMatchInlineSnapshot(`x_0`);
    expect(parse('x^2_0')).toMatchInlineSnapshot(`["Square", "x_0"]`);
    expect(parse('x_0^2')).toMatchInlineSnapshot(`["Square", "x_0"]`);
    expect(parse('x_{n+1}')).toMatchInlineSnapshot(
      `["Subscript", "x", ["Add", "n", 1]]`
    );
    expect(parse('x_n_{+1}')).toMatchInlineSnapshot(
      `["Subscript", "x", ["List", "n", 1]]`
    );
  });
  test('Pre-sup, pre-sub', () => {
    expect(parse('_p^qx')).toMatchInlineSnapshot(
      `["Multiply", "_", ["Power", "p", "q"], "x"]`
    ); // @fixme: nope...
    expect(parse('_p^qx_r^s')).toMatchInlineSnapshot(
      `["Multiply", "_", ["Power", "p", "q"], ["Power", "x_r", "s"]]`
    ); // @fixme: nope...
    expect(parse('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Triple",
        "_",
        ["Power", ["Add", "p", 1], ["Add", "q", 1]],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
            ["Subscript", "x", ["Add", "r", 1]]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
    expect(parse('x{}_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Pair",
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
            ["Subscript", "x", ["Add", "p", 1]]
          ],
          ["Add", "q", 1]
        ],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
            ["Subscript", "x", ["Add", "r", 1]]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
  });
  test('Sup/Sub groups', () => {
    expect(parse('(x+1)^{n-1}')).toMatchInlineSnapshot(
      `["Power", ["Add", "x", 1], ["Subtract", "n", 1]]`
    );
    expect(parse('(x+1)_{n-1}')).toMatchInlineSnapshot(`
      [
        "Subscript",
        ["Delimiter", ["Sequence", ["Add", "x", 1]]],
        ["Subtract", "n", 1]
      ]
    `);
    expect(parse('(x+1)^n_0')).toMatchInlineSnapshot(`
      [
        "Power",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
          ["Subscript", ["Delimiter", ["Sequence", ["Add", "x", 1]]], 0]
        ],
        "n"
      ]
    `);
    expect(parse('^p_q{x+1}^n_0')).toMatchInlineSnapshot(`
      [
        "Superscript",
        ["Error", "'missing'", ["LatexString", "'^'"]],
        ["Error", "'missing'"]
      ]
    `); // @fixme: nope...
    expect(parse('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `["Superscript", ["Error", "'missing'", ["LatexString", "'^'"]], 12]`
    ); // @fixme: nope...
  });
  test('Accents', () => {
    expect(parse('\\vec{x}')).toMatchInlineSnapshot(`["OverVector", "x"]`);
    expect(parse('\\vec{AB}')).toMatchInlineSnapshot(
      `["OverVector", ["Multiply", "A", "B"]]`
    ); // @fixme: nope...
    expect(parse('\\vec{AB}^{-1}')).toMatchInlineSnapshot(
      `["Divide", 1, ["OverVector", ["Multiply", "A", "B"]]]`
    );
  });
});

describe('PRIME', () => {
  test('Valid forms', () => {
    expect(parse("f'")).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(parse("f''")).toMatchInlineSnapshot(`["Derivative", "f", 2]`);
    expect(parse("f'''")).toMatchInlineSnapshot(`["Derivative", "f", 3]`);
    expect(parse('f\\prime')).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(parse('f\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(parse('f\\prime\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(parse('f\\doubleprime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(parse('f^{\\prime}')).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(parse('f^{\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(parse('f^{\\prime\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(parse('f^{\\doubleprime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
  });
});
