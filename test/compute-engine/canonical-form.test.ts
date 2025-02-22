import { check } from '../utils';

describe('CANONICAL FORMS', () => {
  test('-0', () => {
    expect(check('-0')).toMatchInlineSnapshot(`
      latex     = 0
      0
    `);
  });

  // Addition/substraction of 0 gets simplified in canonical  form
  test('a-0', () => {
    expect(check('a-0')).toMatchInlineSnapshot(`
      latex     = ["Subtract", "a", 0]
      a
    `);
  });

  test('0-a', () => {
    expect(check('0-a')).toMatchInlineSnapshot(`
      latex     = ["Subtract", 0, "a"]
      ["Negate", "a"]
    `);
  });

  // Small integers are *not* coalesced in canonical form
  test('7 + 2 + 5"', () => {
    expect(check('7 + 2 + 5')).toMatchInlineSnapshot(`
      latex     = ["Add", 7, 2, 5]
      box       = ["Add", 2, 5, 7]
      simplify  = 14
    `);
  });

  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  test('2^3x"', () => {
    expect(check('2^3x')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", ["Power", 2, 3], "x"]
      box       = ["Multiply", ["Power", 2, 3], "x"]
      canonical = ["Multiply", 8, "x"]
    `);
  });

  // Negative sign on denom, numer or both
  test('\\frac{-x}{-n}"', () => {
    expect(check('\\frac{-x}{-n}')).toMatchInlineSnapshot(`
      latex     = ["Divide", ["Negate", "x"], ["Negate", "n"]]
      ["Divide", "x", "n"]
    `);
  });

  test('\\frac{x}{-n}"', () => {
    expect(check('\\frac{x}{-n}')).toMatchInlineSnapshot(`
      latex     = ["Divide", "x", ["Negate", "n"]]
      ["Divide", ["Negate", "x"], "n"]
    `);
  });

  test('\\frac{-x}{n}"', () => {
    expect(check('\\frac{-x}{n}')).toMatchInlineSnapshot(`
      latex     = ["Divide", ["Negate", "x"], "n"]
      ["Divide", ["Negate", "x"], "n"]
    `);
  });

  test('\\frac{-101}{10^{\\frac{2}{3}}}', () => {
    expect(check('\\frac{-101}{10^{\\frac{2}{3}}}')).toMatchInlineSnapshot(`
      latex     = ["Divide", -101, ["Power", 10, ["Divide", 2, 3]]]
      box       = ["Divide", -101, ["Power", 10, ["Rational", 2, 3]]]
      N-auto    = -21.75979036932202558976886502184544000211938391614029668314127861409875217714824208187295918578675709
      N-mach    = -21.75979036932203
    `);
  });

  // Flatten, to multiple levels
  test('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))"', () => {
    expect(check('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'))
      .toMatchInlineSnapshot(`
      latex     = [
        "InvisibleOperator",
        [
          "Delimiter",
          [
            "Sequence",
            [
              "Add",
              1,
              [
                "Delimiter",
                [
                  "Sequence",
                  ["Add", 2, ["Delimiter", ["Sequence", ["Add", 3, 4]]]]
                ]
              ]
            ]
          ]
        ],
        [
          "Delimiter",
          [
            "Sequence",
            [
              "InvisibleOperator",
              [
                "Delimiter",
                [
                  "Sequence",
                  ["Add", ["Delimiter", ["Sequence", ["Add", 5, 6]]], 7]
                ]
              ],
              [
                "Delimiter",
                [
                  "Sequence",
                  [
                    "Delimiter",
                    [
                      "Sequence",
                      ["Add", 8, ["Delimiter", ["Sequence", ["Add", 9, 10]]]]
                    ]
                  ]
                ]
              ],
              [
                "Delimiter",
                [
                  "Sequence",
                  [
                    "Add",
                    11,
                    ["Delimiter", ["Sequence", ["Add", 12, 13]]],
                    14
                  ]
                ]
              ]
            ]
          ]
        ]
      ]
      box       = [
        "Multiply",
        ["Add", 1, 2, 3, 4],
        ["Add", 5, 6, 7],
        ["Add", 8, 9, 10],
        ["Add", 11, 12, 13, 14]
      ]
      canonical = [
        "Multiply",
        ["Add", 5, 6, 7],
        ["Add", 8, 9, 10],
        ["Add", 1, 2, 3, 4],
        ["Add", 11, 12, 13, 14]
      ]
      simplify  = 243000
    `);
  });

  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  test('2x\\frac{0}{5}"', () => {
    expect(check('2x\\frac{0}{5}')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", 2, "x", ["Divide", 0, 5]]
      box       = ["Multiply", 2, "x", 0]
      canonical = 0
    `);
  });

  // Negative exponents become fractions
  test('2xy^{-n}"', () => {
    expect(check('2xy^{-n}')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", 2, "x", ["Power", "y", ["Negate", "n"]]]
      ["Multiply", 2, "x", ["Power", "y", ["Negate", "n"]]]
    `);
  });

  test('2\\times0\\times5\\times4"', () => {
    expect(check('2\\times0\\times5\\times4')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, 0, 5, 4]
      0
    `);
  });

  test('2\\times(5-5)\\times5\\times4"', () => {
    expect(check('2\\times(5-5)\\times5\\times4')).toMatchInlineSnapshot(`
      latex     = ["Multiply", 2, ["Delimiter", ["Sequence", ["Subtract", 5, 5]]], 5, 4]
      box       = ["Multiply", 40, ["Subtract", 5, 5]]
      simplify  = 0
    `);
  });

  test('2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(check('2\\frac{x}{a}\\frac{y}{b}')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", 2, ["Divide", "x", "a"], ["Divide", "y", "b"]]
      ["Divide", ["Multiply", 2, "x", "y"], ["Multiply", "a", "b"]]
    `);
  });
});

//
// COMMUTATIVE ORDER
// (for multiplication, and other commutative functios, except addition)
//
describe('COMMUTATIVE ORDER', () => {
  // multiply is commutative and regular canonical sort order applies
  // (numbers before symbols)
  test(`Canonical form yx5z`, () => {
    expect(check('yx5z')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "y", "x", 5, "z"]
      box       = ["Multiply", "y", "x", 5, "z"]
      canonical = ["Multiply", 5, "x", "y", "z"]
    `);
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  test(`Canonical form '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y'`, () => {
    expect(check('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y')).toMatchInlineSnapshot(`
      latex     = [
        "InvisibleOperator",
        -2,
        "x",
        5,
        "z",
        ["Sqrt", "y"],
        ["Divide", 3, 4],
        3,
        "Pi",
        "y"
      ]
      box       = [
        "Multiply",
        -2,
        "x",
        5,
        "z",
        ["Sqrt", "y"],
        ["Rational", 3, 4],
        3,
        "Pi",
        "y"
      ]
      canonical = [
        "Multiply",
        ["Rational", -45, 2],
        "Pi",
        "x",
        "z",
        ["Power", "y", ["Rational", 3, 2]]
      ]
      N-auto    = [
        "Multiply",
        "-70.68583470577034786540947612378881489443631148593988097193625332692586914143970246913078357019763403",
        "x",
        "z",
        ["Power", "y", 1.5]
      ]
      N-mach    = ["Multiply", -70.68583470577035, "x", "z", ["Power", "y", 1.5]]
    `);
  });

  test(`Canonical form '(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)'`, () => {
    expect(check('(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)')).toMatchInlineSnapshot(`
      latex     = [
        "InvisibleOperator",
        [
          "Delimiter",
          [
            "Sequence",
            ["InvisibleOperator", ["Power", "b", 3], ["Power", "c", 2], "d"]
          ]
        ],
        [
          "Delimiter",
          ["Sequence", ["InvisibleOperator", ["Power", "x", 7], "y"]]
        ],
        [
          "Delimiter",
          ["Sequence", ["InvisibleOperator", ["Power", "a", 5], "g"]]
        ],
        [
          "Delimiter",
          [
            "Sequence",
            [
              "InvisibleOperator",
              ["Power", "b", 2],
              ["Power", "x", 5],
              "b",
              3
            ]
          ]
        ]
      ]
      box       = [
        "Multiply",
        ["Power", "b", 3],
        ["Square", "c"],
        "d",
        ["Power", "x", 7],
        "y",
        ["Power", "a", 5],
        "g",
        ["Square", "b"],
        ["Power", "x", 5],
        "b",
        3
      ]
      canonical = [
        "Multiply",
        3,
        "d",
        "g",
        "y",
        ["Square", "c"],
        ["Power", "a", 5],
        ["Power", "b", 6],
        ["Power", "x", 12]
      ]
    `);
  });
});

//
// POLYNOMIAL ORDER
// (for addition)
//

describe('POLYNOMIAL ORDER', () => {
  // addition is deglex ordered, numbers after symbols
  test(`Canonical form c+7+a+5+b`, () => {
    expect(check('c+7+a+5+b')).toMatchInlineSnapshot(`
      latex     = ["Add", "c", 7, "a", 5, "b"]
      box       = ["Add", "a", "b", "c", 5, 7]
      simplify  = ["Add", "a", "b", "c", 12]
    `);
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  test(`Canonical form 6+5c+2b+3+7a'`, () => {
    expect(check('6+5c+2b+3+7a')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        6,
        ["InvisibleOperator", 5, "c"],
        ["InvisibleOperator", 2, "b"],
        3,
        ["InvisibleOperator", 7, "a"]
      ]
      box       = [
        "Add",
        ["Multiply", 7, "a"],
        ["Multiply", 2, "b"],
        ["Multiply", 5, "c"],
        3,
        6
      ]
      simplify  = [
        "Add",
        ["Multiply", 7, "a"],
        ["Multiply", 2, "b"],
        ["Multiply", 5, "c"],
        9
      ]
    `);
  });

  // Arguments sorted by value
  test(`Canonical form 5a+3a+7a`, () => {
    expect(check('5a+3a+7a')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        ["InvisibleOperator", 5, "a"],
        ["InvisibleOperator", 3, "a"],
        ["InvisibleOperator", 7, "a"]
      ]
      box       = [
        "Add",
        ["Multiply", 5, "a"],
        ["Multiply", 3, "a"],
        ["Multiply", 7, "a"]
      ]
      simplify  = ["Multiply", 15, "a"]
    `);
  });

  // deglex sorting order
  // by total degree, then lexicographically
  // If degree is the same, longest factor
  test(`Canonical form x^{3}2\\pi+3x^{3}4\\pi+x^3`, () => {
    expect(check('x^{3}2\\pi+3x^{3}4\\pi+x^3')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        ["InvisibleOperator", ["Power", "x", 3], 2, "Pi"],
        ["InvisibleOperator", 3, ["Power", "x", 3], 4, "Pi"],
        ["Power", "x", 3]
      ]
      box       = [
        "Add",
        ["Multiply", ["Power", "x", 3], 2, "Pi"],
        ["Multiply", 3, ["Power", "x", 3], 4, "Pi"],
        ["Power", "x", 3]
      ]
      canonical = [
        "Add",
        ["Multiply", 2, "Pi", ["Power", "x", 3]],
        ["Multiply", 12, "Pi", ["Power", "x", 3]],
        ["Power", "x", 3]
      ]
      simplify  = ["Add", ["Multiply", 14, "Pi", ["Power", "x", 3]], ["Power", "x", 3]]
      N-auto    = [
        "Add",
        [
          "Multiply",
          "6.283185307179586476925286766559005768394338798750211641949889184615632812572417997256069650684234136",
          ["Power", "x", 3]
        ],
        [
          "Multiply",
          "37.69911184307751886155172059935403461036603279250126985169933510769379687543450798353641790410540482",
          ["Power", "x", 3]
        ],
        ["Power", "x", 3]
      ]
      N-mach    = [
        "Add",
        ["Multiply", 6.283185307179586, ["Power", "x", 3]],
        ["Multiply", 37.69911184307752, ["Power", "x", 3]],
        ["Power", "x", 3]
      ]
    `);
  });

  test(`Canonical form 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2'`, () => {
    expect(check('x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        ["InvisibleOperator", ["Power", "x", 2], ["Power", "y", 3]],
        ["InvisibleOperator", ["Power", "x", 3], ["Power", "y", 2]],
        ["InvisibleOperator", "x", ["Power", "y", 4]],
        ["InvisibleOperator", ["Power", "x", 4], "y"],
        ["InvisibleOperator", ["Power", "x", 2], ["Power", "y", 2]]
      ]
      box       = [
        "Add",
        ["Multiply", ["Square", "x"], ["Power", "y", 3]],
        ["Multiply", ["Power", "x", 3], ["Square", "y"]],
        ["Multiply", ["Square", "x"], ["Square", "y"]],
        ["Multiply", ["Power", "x", 4], "y"],
        ["Multiply", "x", ["Power", "y", 4]]
      ]
      canonical = [
        "Add",
        ["Multiply", ["Square", "x"], ["Power", "y", 3]],
        ["Multiply", ["Square", "x"], ["Square", "y"]],
        ["Multiply", ["Square", "y"], ["Power", "x", 3]],
        ["Multiply", "x", ["Power", "y", 4]],
        ["Multiply", "y", ["Power", "x", 4]]
      ]
    `);
  });

  test(`Canonical form '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'`, () => {
    expect(check('(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'))
      .toMatchInlineSnapshot(`
      latex     = [
        "Add",
        [
          "Delimiter",
          [
            "Sequence",
            ["InvisibleOperator", ["Power", "b", 3], ["Power", "b", 2]]
          ]
        ],
        [
          "Delimiter",
          [
            "Sequence",
            ["InvisibleOperator", ["Power", "a", 3], ["Power", "a", 2]]
          ]
        ],
        ["Delimiter", ["Sequence", ["Power", "b", 6]]],
        [
          "Delimiter",
          ["Sequence", ["InvisibleOperator", ["Power", "a", 5], "b"]]
        ],
        ["Delimiter", ["Sequence", ["Power", "a", 5]]]
      ]
      box       = [
        "Add",
        ["Multiply", ["Power", "a", 3], ["Square", "a"]],
        ["Multiply", ["Power", "a", 5], "b"],
        ["Multiply", ["Power", "b", 3], ["Square", "b"]],
        ["Power", "a", 5],
        ["Power", "b", 6]
      ]
      canonical = [
        "Add",
        ["Multiply", "b", ["Power", "a", 5]],
        ["Power", "a", 5],
        ["Power", "a", 5],
        ["Power", "b", 6],
        ["Power", "b", 5]
      ]
      simplify  = [
        "Add",
        ["Multiply", 2, ["Power", "a", 5]],
        ["Multiply", "b", ["Power", "a", 5]],
        ["Power", "b", 6],
        ["Power", "b", 5]
      ]
    `);
  });

  test(`Canonical form '5c^2a^4+2b^8+7b^3a'`, () => {
    expect(check('5c^2a^4+2b^8+7b^3a')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        ["InvisibleOperator", 5, ["Power", "c", 2], ["Power", "a", 4]],
        ["InvisibleOperator", 2, ["Power", "b", 8]],
        ["InvisibleOperator", 7, ["Power", "b", 3], "a"]
      ]
      box       = [
        "Add",
        ["Multiply", 2, ["Power", "b", 8]],
        ["Multiply", 7, ["Power", "b", 3], "a"],
        ["Multiply", 5, ["Square", "c"], ["Power", "a", 4]]
      ]
      canonical = [
        "Add",
        ["Multiply", 2, ["Power", "b", 8]],
        ["Multiply", 5, ["Square", "c"], ["Power", "a", 4]],
        ["Multiply", 7, "a", ["Power", "b", 3]]
      ]
    `);
  });
});

// describe('OBJECT LITERAL FORM', () => {
//   test('Shorthand parse', () => {
//     expect(
//       engine.format(['Add', 'x', ['Sin', 'Pi'], 2], ['object-literal'])
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add'}, {sym: 'x'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}]}, {num: '2'}]}`
//     );
//   });
//   test('Expression with metadata', () => {
//     expect(
//       engine.format(
//         [
//           { sym: 'Add', metadata: 'add' },
//           { sym: 'x', metadata: 'ecks' },
//           { fn: ['Sin', 'Pi'], metadata: 'fn-md' },
//           { num: '1', metadata: 'one' },
//         ] as any,
//         ['object-literal']
//       )
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add', metadata: 'add'}, {sym: 'x', metadata: 'ecks'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}], metadata: 'fn-md'}, {num: '1', metadata: 'one'}]}`
//     );
//   });
// });
