import { Expression } from '../../../src/math-json';
import { engine as ce } from '../../utils';

function json(latex: string): Expression {
  return ce.parse(latex)?.json ?? '';
}

describe('INTEGRAL', () => {
  test('simple with no index', () => {
    expect(json('\\int\\sin x + 1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Integrate", ["Add", ["Sin", "x"], 1], "Nothing"], 2]`
    );
  });

  test('simple with d', () => {
    expect(
      json('\\int\\sin x \\operatorname{d} x+1 = 2')
    ).toMatchInlineSnapshot(
      `["Equal", ["Add", ["Integrate", ["Sin", "x"], "x"], 1], 2]`
    );
  });
  test('simple with mathrm', () => {
    expect(json('\\int\\sin x dx+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", ["Integrate", ["Sin", "x"], "x"], 1], 2]`
    );
  });

  test('simple with \\alpha', () => {
    expect(json('\\int\\alpha d\\alpha+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", ["Integrate", "alpha", "alpha"], 1], 2]`
    );
  });

  test('simple with mathrm with spacing', () => {
    expect(
      json('\\int\\sin x \\, \\operatorname{d}x+1 = 2')
    ).toMatchInlineSnapshot(
      `["Equal", ["Add", ["Integrate", ["Sin", "x"], "x"], 1], 2]`
    );
  });

  test('simple with lower bound', () => {
    expect(
      json('\\int_0\\sin x \\, \\operatorname{d}x+1 = 2')
    ).toMatchInlineSnapshot(
      `["Equal", ["Add", ["Integrate", ["Sin", "x"], ["Pair", "x", 0]], 1], 2]`
    );
  });

  test('simple with upper bound', () => {
    expect(json('\\int^\\infty\\sin x \\, \\operatorname{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            ["Sin", "x"],
            ["Triple", "x", "Nothing", {num: "+Infinity"}]
          ],
          1
        ],
        2
      ]
    `);
  });
  test('simple with lower and upper bound', () => {
    expect(json('\\int^\\infty_0\\sin x \\, \\operatorname{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          ["Integrate", ["Sin", "x"], ["Triple", "x", 0, {num: "+Infinity"}]],
          1
        ],
        2
      ]
    `);
  });

  test('simple with lower and upper bound and no index', () =>
    expect(json('\\int^\\infty_0\\sin x +1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Sin", "x"], 1],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3xdx}{5} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Divide", ["Multiply", 3, "x"], 5],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with \\operatorname{d}x in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3x\\operatorname{d}x}{5} = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Divide", ["Multiply", 3, "x"], 5],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('INVALID with dx in frac denom', () =>
    expect(json('\\int^\\infty_0\\frac{3x}{5dx} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Divide", ["Multiply", 3, "x"], ["Multiply", 5, "d", "x"]],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `)); // @fixme, should error

  test('with dx in addition', () =>
    expect(json('\\int^\\infty_03x+kxdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Multiply", "k", "x"], ["Multiply", 3, "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in negate', () =>
    expect(json('\\int^\\infty_0-xdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Negate", "x"],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2dx) = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Multiply", 3, "x"], ["Square", "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx AFTER delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2)dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Multiply", 3, "x"], ["Square", "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx after trig', () =>
    expect(json('\\int^\\infty_0\\sin x dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        ["Integrate", ["Sin", "x"], ["Triple", "x", 0, {num: "+Infinity"}]],
        2
      ]
    `));

  test('numerically evaluated via N', () =>
    expect(
      Math.round(
        10 *
          (ce.box(['N', ce.parse('\\int^2_0\\frac{3x}{5}dx')]).value! as number)
      )
    ).toEqual(12));

  test('numerically evaluated', () =>
    expect(
      Math.round(10 * (ce.parse('\\int^2_0\\frac{3x}{5}dx').value! as number))
    ).toEqual(12));
});

describe('LIMIT', () => {
  expect(
    ce.box(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0]).value
  ).toMatchInlineSnapshot(`1`);

  expect(
    ce.box(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0]).value
  ).toMatchInlineSnapshot(`1`);

  expect(
    ce.box(['NLimit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .value
  ).toMatchInlineSnapshot(`1`);

  expect(
    ce.box(['NLimit', ['Divide', ['Sin', '_'], '_'], 0]).value
  ).toMatchInlineSnapshot(`1`);

  // Should be "1"
  expect(
    ce.box([
      'NLimit',
      ['Function', ['Cos', ['Divide', 1, 'x']], 'x'],
      'Infinity',
    ]).value
  ).toMatchInlineSnapshot(`1`);

  expect(
    ce.parse('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}').value
  ).toMatchInlineSnapshot(`1`);
});
