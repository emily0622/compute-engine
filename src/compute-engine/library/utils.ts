import { checkDomain } from '../boxed-expression/validate';
import { MAX_ITERATION, asSmallInteger } from '../numerics/numeric';
import { BoxedExpression } from '../public';

/**
 * Assume the caller has setup a scope. The index
 * variable will be declared in that scope.
 *
 * @param indexingSet
 *
 */
export function canonicalIndexingSet(
  indexingSet: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!indexingSet) return undefined;

  const ce = indexingSet.engine;

  let index: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;
  let upper: BoxedExpression | null = null;
  if (
    indexingSet.head !== 'Tuple' &&
    indexingSet.head !== 'Triple' &&
    indexingSet.head !== 'Pair' &&
    indexingSet.head !== 'Single'
  ) {
    index = indexingSet;
  } else {
    // Don't canonicalize the index. Canonicalization has the
    // side effect of declaring the symbol, here we're using
    // it to do a local declaration
    index = indexingSet.ops![0] ?? null;
    lower = indexingSet.ops![1]?.canonical ?? null;
    upper = indexingSet.ops![2]?.canonical ?? null;
  }
  if (index.head === 'Hold') index = index.op1;

  if (index.symbol) {
    ce.declare(index.symbol, { domain: 'Integers' });
    index.bind();
    index = ce.hold(index);
  } else index = ce.domainError('Symbols', index.domain, index);

  // The range bounds, if present, should be integers numbers
  if (lower && lower.isFinite) lower = checkDomain(ce, lower, 'Integers');
  if (upper && upper.isFinite) upper = checkDomain(ce, upper, 'Integers');

  if (lower && upper) return ce.tuple([index, lower, upper]);
  if (upper) return ce.tuple([index, ce.One, upper]);
  if (lower) return ce.tuple([index, lower]);

  return index;
}

/**
 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 *
 * This can take several valid forms:
 * - a symbol, e.g. `n`, the upper and lower bounds are assumed ot be infinity
 * - a tuple, e.g. `["Pair", "n", 1]` or `["Tuple", "n", 1, 10]` with one or two bounds
 *
 * The result is a normalized version that includes the
 * index, the lower and upper bounds of the range, and
 * a flag indicating whether the range is finite.
 * @param limits
 * @returns
 */
export function normalizeIndexingSet(
  limits: BoxedExpression | undefined
): [
  index: string | undefined,
  lower: number,
  upper: number,
  isFinite: boolean,
] {
  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index: string | undefined = undefined;
  let isFinite = true;
  if (
    limits &&
    (limits.head === 'Tuple' ||
      limits.head === 'Triple' ||
      limits.head === 'Pair' ||
      limits.head === 'Single')
  ) {
    index =
      (limits.op1.head === 'Hold'
        ? limits.op1.op1.symbol
        : limits.op1.symbol) ?? 'Nothing';
    lower = asSmallInteger(limits.op2) ?? 1;

    if (!Number.isFinite(lower)) isFinite = false;

    if (limits.op3.isNothing || limits.op3.isInfinity) {
      isFinite = false;
    } else {
      const u = asSmallInteger(limits.op3);
      if (u === null) isFinite = false;
      else {
        upper = u;
        if (!Number.isFinite(upper)) isFinite = false;
      }
    }
    if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;
  } else if (limits) {
    // Assume we only have an index, no bounds
    index =
      (limits.head === 'Hold' ? limits.op1.symbol : limits.symbol) ?? 'Nothing';
    lower = 1;
    upper = lower + MAX_ITERATION;
  }
  return [index, lower, upper, isFinite];
}
