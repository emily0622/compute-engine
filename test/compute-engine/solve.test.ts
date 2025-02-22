import { engine } from '../utils';

function expr(s: string) {
  return engine.parse(s);
}

const eqn = engine.box(['Multiply', '5', 'x']);

console.log(engine.pattern(['Multiply', 'x', '__a']).match(eqn));

describe('SOLVING A QUADRATIC EQUATION', () => {
  const ce = engine;

  it('should solve bx', () => {
    const eqn = ce.box(['Multiply', 5, 'x']);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[0]`);
  });

  it('should solve bx + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 5, 'x'], -10]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[2]`);
  });

  it('should solve ax^2', () => {
    const eqn = ce.box(['Multiply', 16, ['Square', 'x']]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[0]`);
  });

  it('should solve ax^2 + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 2, ['Square', 'x']], -16]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[2]`);
  });

  it('should solve ax^2 + bx + c', () => {
    const eqn = ce.box([
      'Add',
      ['Multiply', 2, ['Square', 'x']],
      ['Multiply', 6, 'x'],
      4,
    ]);

    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[-1, -2]`);
  });
});

describe('expr.solve()', () => {
  test('should solve an assignment', () => {
    const e = expr('x = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([5]);
  });

  test('should solve an assignment to a root', () => {
    const e = expr('x = \\sqrt{5}');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([['Sqrt', 5]]);
  });

  test('should solve an assignment to a variable', () => {
    const e = expr('x = y');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual(['y']);
  });

  test('should solve a simple equation with a variable', () => {
    const e = expr('x - 1 + y = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([['Subtract', 1, 'y']]);
  });

  test('should solve a simple equation', () => {
    const e = expr('x + 2 = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([3]);
  });

  test('should solve an equation with a fractional coefficient', () => {
    const e = expr('\\frac{2}{3}x + \\frac{1}{3} = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([7]);
  });

  test('should solve an equation with a fractional root', () => {
    const e = expr('x^2 + 2x + \\frac{1}{4} = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([
      ['Divide', ['Subtract', ['Sqrt', 3], 2], 2],
      ['Divide', ['Subtract', -2, ['Sqrt', 3]], 2],
    ]);
  });

  test('should solve an equation with a complex root', () => {
    const e = expr('x^2 + 1 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([['Complex', 0, 1]]);
  });

  test('should **NOT** solve a quasi-quadratic equation', () => {
    const e = expr('x^2 + 3x + 2 + \\sin(x) = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[]`);
  });

  // test('should solve an inequality', () => {
  //   const e = expr('2x + 1 < 5');
  //   const result = e.solve('x')?.map((x) => x.json);
  //   expect(result).toMatchInlineSnapshot(`[]`); // @todo
  // });

  // test('should solve a system of equations', () => {
  //   const e1 = expr('x + y = 3');
  //   const e2 = expr('2x - y = 0');
  //   const result = expr([e1, e2]).solve(['x', 'y']);
  //   expect(result).toEqual(expr('x = 0, y = 3'));
  // });
});
