import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  complexAllowed,
  bignumPreferred,
  asBigint,
} from '../boxed-expression/utils';
import {
  asBignum,
  asFloat,
  asSmallInteger,
  factorPower,
} from '../numerics/numeric';
import {
  bigint,
  factorPower as bigFactorPower,
} from '../numerics/numeric-bigint';
import {
  asRational,
  isBigRational,
  isMachineRational,
  isRational,
  isRationalOne,
  machineDenominator,
  machineNumerator,
  mul,
} from '../numerics/rationals';
import { BoxedExpression, IComputeEngine, Metadata, Rational } from '../public';
import { applyN } from '../symbolic/utils';

/**
 *
 */
export function canonicalPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  metadata?: Metadata
): BoxedExpression {
  if (exponent.symbol === 'ComplexInfinity') return ce.NaN;

  if (exponent.isZero) return ce.One;

  if (exponent.isOne) return base;

  if (exponent.isNegativeOne) return ce.inv(base);

  if (exponent.numericValue !== null) {
    if (base.numericValue !== null) {
      const numBase = asFloat(base);

      //
      // Special cases
      //
      // Implement same results as sympy.
      // See https://docs.sympy.org/1.6/modules/core.html#pow
      //
      // if (base.isOne) return ce._ONE;
      if (numBase === 1) return ce.One;
      // if (base.isZero) {
      if (numBase === 0) {
        if (exponent.isPositive) return ce.Zero;
        if (exponent.isNegative) return ce.ComplexInfinity; //  Unsigned Infinity...
      }

      //  x^(-1)
      if (exponent.isNegativeOne) return ce.inv(base);

      // x^{0.5}, x^{1/2} -> Square Root
      const e = asFloat(exponent);
      if (e === 0.5 || e === -0.5) {
        const b = asSmallInteger(base);
        if (b !== null && b > 0) {
          // Factor out small integers
          // √(12) -> 2√3
          const [coef, radicand] = factorPower(b, 2);

          if (radicand === 1 && coef === 1) return ce.One;
          if (coef !== 1) {
            if (radicand === 1) return ce.number(e >= 0 ? coef : [1, coef]);
            return ce.mul([
              ce.number(coef),
              ce._fn('Sqrt', [ce.number(radicand)]),
            ]);
          }
          if (e > 0) return ce._fn('Sqrt', [base], metadata);
          return ce.inv(ce._fn('Sqrt', [base]), metadata);
        }

        if (e > 0) return ce._fn('Power', [base, ce.Half], metadata);
        return ce._fn('Power', [base, ce.number([-1, 2])], metadata);
      }

      if (base.isInfinity) {
        if (exponent.numericValue instanceof Complex) {
          const re = exponent.numericValue.re;
          if (re === 0) return ce.NaN;
          if (re < 0) return ce.Zero;
          if (re > 0) return ce.ComplexInfinity;
        }
        if (base.isNegative) {
          // base = -∞
          if (exponent.isInfinity) return ce.NaN;
        } else if (base.isPositive) {
          // base = +∞
          if (exponent.isNegativeOne) return ce.Zero;
          if (exponent.isInfinity)
            return exponent.isNegative ? ce.Zero : ce.PositiveInfinity;
        }
      }

      if (exponent.isInfinity && (base.isOne || base.isNegativeOne))
        return ce.NaN;
    }
  }

  //
  // Power rule
  //
  if (base.head === 'Power' && base.op1.isReal) {
    const a = asSmallInteger(exponent);
    if (a !== null) {
      const b = asSmallInteger(base.op2);
      if (b !== null) {
        return ce.pow(base.op1, ce.number(a * b));
      }
    }
    if (base.op1.isNonNegative) {
      const ar = asRational(exponent);
      if (ar) {
        const br = asRational(base.op2);
        if (br) return ce.pow(base.op1, ce.number(mul(ar, br)));
      }
    }
  }

  // Distribute over multiplication
  // (abc)^n -> a^n b^n c^n
  if (base.head === 'Multiply') {
    const e = asSmallInteger(exponent);
    if (e !== null)
      return ce._fn(
        'Multiply',
        base.ops!.map((x) => ce.pow(x, exponent!))
      ); // Don't call ce.mul() to avoid infinite loops
  }

  return ce._fn('Power', [base, exponent], metadata);
}

export function square(
  ce: IComputeEngine,
  base: BoxedExpression
): BoxedExpression {
  const num = base.numericValue;
  if (typeof num === 'number') return ce.number(num * num);
  if (num instanceof Decimal) return ce.number(num.pow(2));
  if (num instanceof Complex) return ce.number(num.pow(2));
  if (isMachineRational(num))
    return ce.number([num[1] * num[1], num[0] * num[0]]);
  if (isBigRational(num)) return ce.number([num[1] * num[1], num[0] * num[0]]);

  if (base.head === 'Multiply')
    return ce._fn(
      'Multiply',
      base.ops!.map((x) => square(ce, x))
    ); // Don't call ce.mul() to avoid infinite loops

  if (base.head === 'Power') {
    const exp = asSmallInteger(base.op2);
    if (exp !== null) return ce.pow(base.op1, ce.number(exp * 2));
    return ce.pow(base.op1, ce.mul([ce.number(2), base.op2]));
  }

  return ce.pow(base, ce.number(2));
}

function numEvalPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression
): BoxedExpression | undefined {
  if (base.numericValue === null || exponent.numericValue === null)
    return undefined;

  //
  // Complex base or exponent
  //
  if (base.numericValue instanceof Complex) {
    if (exponent.numericValue instanceof Complex)
      return ce.number(base.numericValue.pow(exponent.numericValue));
    return ce.number(base.numericValue.pow(asFloat(exponent) ?? NaN));
  }

  if (exponent.numericValue instanceof Complex) {
    const b = asFloat(base) ?? null;
    if (b !== null) return ce.number(ce.complex(b).pow(exponent.numericValue));
    return undefined;
  }

  //
  // Bignum
  //
  const invExp = rootExp(exponent);
  if (
    bignumPreferred(ce) ||
    base.numericValue instanceof Decimal ||
    exponent.numericValue instanceof Decimal
  ) {
    const bigBase = asBignum(base);
    const bigExp = asBignum(exponent);
    if (!bigBase || !bigExp) return undefined;
    if (invExp === 2) {
      if (bigBase.isNeg())
        return complexAllowed(ce)
          ? ce.number(ce.complex(0, bigBase.neg().sqrt().toNumber()))
          : ce.NaN;
      return ce.number(bigBase.sqrt());
    }
    if (!bigExp.isInteger() && bigBase.isNeg()) {
      // Complex, if allowed
      if (!complexAllowed(ce)) return ce.NaN;
      const zBase = ce.complex(bigBase.toNumber());
      const zExp = ce.complex(bigExp.toNumber());
      return ce.number(zBase.pow(zExp));
    }
    return ce.number(bigBase.pow(bigExp));
  }

  //
  // Machine
  //
  const floatExp = asFloat(exponent) ?? NaN;
  const floatBase = asFloat(base) ?? NaN;
  if (invExp === 2) {
    if (floatBase < 0) {
      return complexAllowed(ce)
        ? ce.mul([ce.I, ce.number(Math.sqrt(-floatBase))])
        : ce.NaN;
    }
    return ce.number(Math.sqrt(floatBase));
  }
  if (!Number.isInteger(floatExp) && floatBase < 0) {
    if (!complexAllowed(ce)) return ce.NaN;
    const zBase = ce.complex(floatBase);
    const zExp = ce.complex(floatExp);
    return ce.number(zBase.pow(zExp));
  }
  return ce.number(Math.pow(floatBase, floatExp));
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.head === 'Multiply') {
    let c: Rational = bignumPreferred(ce) ? [BigInt(1), BigInt(1)] : [1, 1];
    const xs: BoxedExpression[] = [];
    for (const op of base.ops!) {
      const r = asRational(op);
      if (r) c = mul(c, r);
      else xs.push(op);
    }

    if (!isRationalOne(c))
      return ce.mul([
        processSqrt(ce, ce.number(c), mode) ?? ce.One,
        ce.pow(
          processPower(ce, ce.mul(xs), exponent, mode) ?? ce.mul(xs),
          exponent
        ),
      ]);
  }

  if (base.head === 'Power') {
    // a^-1^-1 -> a
    if (asSmallInteger(base.op2) === -1 && asSmallInteger(exponent) === -1)
      return base.op1;

    const e1 = asRational(base.op2);
    const e2 = asRational(exponent);
    if (e1 && e2) {
      const e = mul(e1, e2);
      return ce.pow(base.op1, e);
    }
    if (mode === 'N') {
      const ef1 = asFloat(base.op2);
      const ef2 = asFloat(exponent);
      if (ef1 !== null && ef2 !== null) {
        const ef = ef1 * ef2;
        if (ef === 0) return ce.One;
        if (ef === 1) return base.op1;
        return ce.pow(base.op1, ef);
      }
    }
  }

  //
  // If square root or cube root, attempt to factor out the perfect
  // factors: sqrt(75) -> 5^2 * 3
  //
  if (mode !== 'N' && base.numericValue !== null && base.isInteger) {
    const smallExpr = asSmallInteger(exponent);
    if (smallExpr) return numEvalPower(ce, base, exponent);

    const r = asRational(exponent);
    if (r) {
      const [n, d] = [machineNumerator(r), machineDenominator(r)];
      if ((n === 1 || n === -1) && (d === 2 || d === 3)) {
        if (bignumPreferred(ce) || base.numericValue instanceof Decimal) {
          const bigBase = asBigint(base)!;
          if (d % 2 === 0 && bigBase < 0 && !complexAllowed(ce)) return ce.NaN;

          const sign =
            bigBase < 0 ? (d % 2 === 0 ? ce.I : ce.NegativeOne) : ce.One;

          const [factor, root] = bigFactorPower(
            bigBase > 0 ? bigBase : -bigBase,
            d
          );

          if (root === BigInt(1) && factor === BigInt(1)) return sign;

          // If factor === 1, nothing special to do, fall through
          if (factor !== BigInt(1)) {
            if (root === BigInt(1))
              return ce.mul([
                sign,
                ce.number(n >= 0 ? factor : [BigInt(1), factor]),
              ]);

            return ce.mul([
              sign,
              ce.number(factor),
              ce.pow(ce.number(root), exponent),
            ]);
          }
        } else if (typeof base.numericValue === 'number') {
          // Square root of a negative number, and no complex allowed
          if (base.numericValue < 0 && d % 2 === 0 && !complexAllowed(ce))
            return ce.NaN;

          const [factor, root] = factorPower(Math.abs(base.numericValue), d);

          const sign =
            base.numericValue < 0
              ? d % 2 === 0
                ? ce.I
                : ce.NegativeOne
              : ce.One;

          if (root === 1 && factor === 1) return sign;
          if (factor !== 1) {
            if (root === 1)
              return ce.mul([sign, ce.number(n >= 0 ? factor : [1, factor])]);

            return ce.mul([
              sign,
              ce.number(factor),
              ce.pow(ce.number(root), exponent),
            ]);
          }
        } else {
          //  @todo: handlebase  rationalValue
        }
      }
      if (base.isNegative) {
        if (!complexAllowed) return ce.NaN;
        return ce.mul([ce.I, ce.fn('Sqrt', [ce.neg(base)])]);
      }
      return undefined;
    }
  }

  if (
    mode !== 'simplify' &&
    base.numericValue !== null &&
    exponent.numericValue !== null
  )
    return numEvalPower(ce, base, exponent);

  return undefined;
}

export function processSqrt(
  ce: IComputeEngine,
  base: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.isOne) return ce.One;
  if (base.isZero) return ce.Zero;
  if (base.isNegativeOne) return complexAllowed(ce) ? ce.I : ce.NaN;
  if (base.isNegative && !complexAllowed(ce)) return ce.NaN;

  const r = asRational(base);

  if (mode === 'N' || (mode === 'evaluate' && !r))
    return applyN(
      base,
      (x) => (x < 0 ? ce.complex(x).sqrt() : Math.sqrt(x)),
      (x) => (x.isNeg() ? ce.complex(x.toNumber()).sqrt() : x.sqrt()),
      (x) => x.sqrt()
    );

  const n = asSmallInteger(base);
  if (n !== null) {
    const [factor, root] = factorPower(Math.abs(n), 2);
    if (n < 0) {
      if (root === 1) ce.mul([ce.number(ce.complex(0, factor))]);
      return ce.mul([
        ce.number(ce.complex(0, factor)),
        ce.sqrt(ce.number(root)),
      ]);
    }
    if (root === 1) return ce.number(factor);
    return ce.mul([ce.number(factor), ce.sqrt(ce.number(root))]);
  }

  if (r) {
    if (isMachineRational(r) && !bignumPreferred(ce)) {
      const [n, d] = r;
      if (
        Math.abs(n) < Number.MAX_SAFE_INTEGER &&
        d < Number.MAX_SAFE_INTEGER
      ) {
        const [nFactor, nRoot] = factorPower(Math.abs(n), 2);
        const [dFactor, dRoot] = factorPower(d, 2);
        if (n < 0)
          return ce.mul([
            ce.number([nFactor, dFactor]),
            ce.sqrt(ce.number([nRoot, dRoot])),
            ce.I,
          ]);

        return ce.mul([
          ce.number([nFactor, dFactor]),
          ce.sqrt(ce.number([nRoot, dRoot])),
        ]);
      }
    }
    if (isBigRational(r) || bignumPreferred(ce)) {
      const n = bigint(r[0]);
      const [nFactor, nRoot] = bigFactorPower(n > 0 ? n : -n, 2);
      const [dFactor, dRoot] = bigFactorPower(bigint(r[1]), 2);

      if (n < 0)
        return ce.mul([
          ce.number([nFactor, dFactor]),
          ce.sqrt(ce.number([nRoot, dRoot])),
          ce.I,
        ]);

      return ce.mul([
        ce.number([nFactor, dFactor]),
        ce.sqrt(ce.number([nRoot, dRoot])),
      ]);
    }
  }

  return undefined;
}

function rootExp(exponent: BoxedExpression): number | null {
  if (typeof exponent.numericValue === 'number') {
    const inv = 1 / exponent.numericValue;
    if (Number.isInteger(inv)) return inv;
    return null;
  }
  if (exponent.numericValue instanceof Decimal) {
    const inv = exponent.engine._BIGNUM_ONE.div(exponent.numericValue);
    if (inv.isInt()) return inv.toNumber();
    return null;
  }

  if (!isRational(exponent.numericValue)) return null;
  const [n, d] = [
    machineNumerator(exponent.numericValue),
    machineDenominator(exponent.numericValue),
  ];
  if (n !== 1 && n !== -1) return null;
  return n * d;
}
