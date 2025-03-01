import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';

import { _BoxedExpression } from './abstract-boxed-expression';

import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  BoxedFunctionDefinition,
  IComputeEngine,
  NOptions,
  BoxedRuleSet,
  SemiBoxedExpression,
  SimplifyOptions,
  Substitution,
  ReplaceOptions,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  RuntimeScope,
  BoxedSubstitution,
  EvaluateOptions,
  BoxedBaseDefinition,
  Hold,
} from '../public';
import { findUnivariateRoots } from '../solve';
import { isRational, signDiff } from '../numerics/rationals';
import { boxRules, replace } from '../rules';
import { SIMPLIFY_RULES } from '../simplify-rules';
import { DEFAULT_COMPLEXITY, order } from './order';
import {
  serializeJsonCanonicalFunction,
  serializeJsonFunction,
} from './serialize';
import { complexAllowed, hashCode, bignumPreferred } from './utils';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { checkNumericArgs, adjustArguments } from './validate';
import { expand } from '../symbolic/expand';
import { apply } from '../function-utils';
import { shouldHold } from '../symbolic/utils';
import { at, isFiniteIndexableCollection } from '../collection-utils';
import { narrow } from './boxed-domain';

/**
 * A boxed function represent an expression that can be
 * represented by a function call.
 *
 * It is composed of a head (the name of the function) and
 * a list of arguments.
 *
 * It has a definition associated with it, based
 * on the head. The definition contains the signature of the function,
 * and the implementation of the function.
 *
 */

export class BoxedFunction extends _BoxedExpression {
  // The head of the function
  private readonly _head: string | BoxedExpression;

  // The arguments of the function
  private readonly _ops: BoxedExpression[];

  // The canonical representation of this expression.
  // If this expression is not canonical, this property is undefined.
  private _canonical: BoxedExpression | undefined;

  // The scope in which this function was defined/boxed
  private _scope: RuntimeScope | null;

  // Note: only canonical expressions have an associated def
  private _def: BoxedFunctionDefinition | undefined;

  private _isPure: boolean;

  // The domain of the value of the function applied to its arguments
  private _result: BoxedDomain | undefined = undefined;

  private _hash: number | undefined;

  constructor(
    ce: IComputeEngine,
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    options ??= {};
    options.canonical ??= false;

    super(ce, options.metadata);

    this._head = head;
    this._ops = ops;

    if (options.canonical) {
      this._canonical = this;
      this.bind();
    }

    ce._register(this);
  }

  //
  // NON-CANONICAL OR CANONICAL OPERATIONS
  //
  // Those operations/properties can be applied to a canonical or
  // non-canonical expression
  //
  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    if (typeof this._head === 'string') h = (h ^ hashCode(this._head)) | 0;
    else h = (h ^ this._head.hash) | 0;
    this._hash = h;
    return h;
  }

  // For function expressions, infer infers the result domain of the function
  infer(domain: BoxedDomain): boolean {
    const def = this._def;
    if (!def) return false;

    if (!def.signature.inferredSignature) return false;

    if (typeof def.signature.result !== 'function')
      def.signature.result = narrow(def.signature.result, domain);
    return true;
  }

  bind(): void {
    // Unbind
    this._def = undefined;

    this._scope = this.engine.context;

    const head = this._head;
    if (typeof head !== 'string') {
      head.bind();
      return;
    }

    this._def = this.engine.lookupFunction(head);
    for (const op of this._ops) op.bind();
  }

  reset(): void {
    // Note: a non-canonical expression is never bound
    // this._def = null;
  }

  get isCanonical(): boolean {
    return this._canonical === this;
  }

  set isCanonical(val: boolean) {
    this._canonical = val ? this : undefined;
  }

  get isPure(): boolean {
    if (this._isPure !== undefined) return this._isPure;
    if (!this.isCanonical) {
      this._isPure = false;
      return false;
    }
    let pure = this.functionDefinition?.pure ?? false;

    // The function might be pure. Let's check that all its arguments are pure.
    if (pure) pure = this._ops.every((x) => x.isPure);

    this._isPure = pure;
    return pure;
  }

  get json(): Expression {
    // If this expression is canonical, apply some transformations to the
    // JSON serialization to "reverse" some of the effects of canonicalization.
    if (this.isValid && this._canonical === this)
      return serializeJsonCanonicalFunction(
        this.engine,
        this._head,
        this._ops,
        { latex: this._latex, wikidata: this.wikidata }
      );
    return serializeJsonFunction(this.engine, this._head, this._ops, {
      latex: this._latex,
      wikidata: this.wikidata,
    });
  }

  // The JSON representation of the expression, without any effects
  // of canonicalization.
  get rawJson(): Expression {
    const head =
      typeof this._head === 'string' ? this._head : this._head.rawJson;
    return [head, ...this.ops.map((x) => x.rawJson)];
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get head(): string | BoxedExpression {
    return this._head;
  }

  get ops(): BoxedExpression[] {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): BoxedExpression {
    return this._ops[0] ?? this.engine.Nothing;
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.Nothing;
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.Nothing;
  }

  get isValid(): boolean {
    if (this._head === 'Error') return false;

    if (typeof this._head !== 'string' && !this._head.isValid) return false;

    return this._ops.every((x) => x?.isValid);
  }

  get canonical(): BoxedExpression {
    this._canonical ??= this.isValid
      ? makeCanonicalFunction(this.engine, this._head, this._ops)
      : this;

    return this._canonical;
  }

  *map<T = BoxedExpression>(
    fn: (x: BoxedExpression) => T
  ): IterableIterator<T> {
    let i = 0;
    while (i < this._ops.length) yield fn(this._ops[i++]);
  }

  // Note: the resulting expression is bound to the current scope, not
  // the scope of the original expression.
  subs(sub: Substitution, options?: { canonical?: boolean }): BoxedExpression {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;

    const ops = this._ops.map((x) => x.subs(sub, options));

    if (options.canonical && ops.every((x) => x.isValid))
      return makeCanonicalFunction(this.engine, this._head, ops);

    return new BoxedFunction(this.engine, this._head, ops, {
      canonical: false,
    });
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  has(x: string | string[]): boolean {
    if (typeof this._head === 'string') {
      if (typeof x === 'string') {
        if (this._head === x) return true;
      } else if (x.includes(this._head)) return true;
    }
    for (const arg of this._ops) if (arg.has(x)) return true;
    return false;
  }

  /** `isSame` is structural/symbolic equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedFunction)) return false;

    // Number of arguments must match
    if (this.nops !== rhs.nops) return false;

    // Head must match
    if (typeof this.head === 'string') {
      if (this.head !== rhs.head) return false;
    } else {
      if (typeof rhs.head === 'string') return false;
      if (
        !rhs.head ||
        !this.engine.box(this.head).isSame(this.engine.box(rhs.head))
      )
        return false;
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    for (let i = 0; i < lhsTail.length; i++)
      if (!lhsTail[i].isSame(rhsTail[i])) return false;

    return true;
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!(rhs instanceof BoxedFunction)) return null;

    let result: BoxedSubstitution = {};

    // Head must match
    if (typeof this.head === 'string') {
      if (this.head !== rhs.head) return null;
    } else {
      if (typeof rhs.head === 'string') return null;
      else {
        if (!rhs.head) return null;
        const m = this.head.match(rhs.head, options);
        if (m === null) return null;
        result = { ...result, ...m };
      }
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    // @todo: need to handle different lengths (sequence pattern)
    for (let i = 0; i < lhsTail.length; i++) {
      const m = lhsTail[i].match(rhsTail[i], options);
      if (m === null) return null;
      result = { ...result, ...m };
    }
    return result;
  }

  //
  // CANONICAL OPERATIONS
  //
  // These operations apply only to canonical expressions
  //

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    return this.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.functionDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this._def;
  }

  /** `isEqual` is mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    const s = signDiff(this, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;

    // Try to simplify the difference of the expressions
    const diff = this.engine.add([this, this.engine.neg(rhs)]).simplify();
    if (diff.isZero) return true;

    return this.isSame(rhs);
  }

  get isNumber(): boolean | undefined {
    return this.domain?.isCompatible('Numbers');
  }
  get isInteger(): boolean | undefined {
    return this.domain?.isCompatible('Integers');
  }
  get isRational(): boolean | undefined {
    return this.domain?.isCompatible('RationalNumbers');
  }
  get isAlgebraic(): boolean | undefined {
    return this.domain?.isCompatible('AlgebraicNumbers');
  }
  get isReal(): boolean | undefined {
    return this.domain?.isCompatible('RealNumbers');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain?.isCompatible('ExtendedRealNumbers');
  }
  get isComplex(): boolean | undefined {
    return this.domain?.isCompatible('ComplexNumbers');
  }
  get isImaginary(): boolean | undefined {
    return this.domain?.isCompatible('ImaginaryNumbers');
  }

  get domain(): BoxedDomain | undefined {
    if (this._result !== undefined) return this._result;
    if (!this.canonical) return undefined;

    const ce = this.engine;

    let result: BoxedDomain | undefined | null = undefined;

    if (typeof this._head !== 'string') {
      result = this._head.domain;
    } else if (this._def) {
      const sig = this._def.signature;
      if (typeof sig.result === 'function') result = sig.result(ce, this._ops);
      else result = sig.result;
    }

    result ??= undefined;

    this._result = result;
    return result;
  }

  // simplify(options?: SimplifyOptions): BoxedExpression {
  //   const result = this.simplifyAll(options);
  //   if (result.length === 1) return result[0];
  //   const ce = this.engine;
  //   result.sort((a, b) => {
  //     if (a === b) return 0;
  //     return ce.costFunction(a) - ce.costFunction(b);
  //   });
  //   return result[0];
  // }

  simplify(options?: SimplifyOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) {
      const canonical = this.canonical;
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.simplify(options);
    }

    //
    // 2/ Apply expand
    //
    const recursive = options?.recursive ?? true;

    let expr: BoxedExpression | undefined | null;
    if (recursive) {
      expr = expand(this);
      if (expr !== null) {
        expr = expr.simplify({ ...options, recursive: false });
        return cheapest(this, expr);
      }
    }

    //
    // 3/ Simplify the applicable operands
    // @todo not clear if this is always the best strategy. Might be better to
    // defer to the handler.
    //
    const def = this.functionDefinition;
    const tail = recursive
      ? holdMap(
          this._ops,
          def?.hold ?? 'none',
          def?.associative ? def.name : '',
          (x) => x.simplify(options)
        )
      : this._ops;

    //
    // 4/ If a function expression, apply the arguments, and simplify the result
    //
    if (typeof this._head !== 'string') {
      const expr = apply(this._head, tail);
      if (typeof expr.head !== 'string') return expr;
      return expr.simplify(options);
    }

    //
    // 5/ Apply `simplify` handler
    //

    if (def) {
      if (def.inert) expr = tail[0]?.canonical ?? this;
      else {
        const sig = def.signature;
        if (sig?.simplify) expr = sig.simplify(this.engine, tail);
      }
    }

    if (!expr) expr = this.engine.fn(this._head, tail);
    else expr = cheapest(this.engine.fn(this._head, tail), expr);

    expr = cheapest(this, expr);

    //
    // 6/ Apply rules, until no rules can be applied
    //
    const rules =
      options?.rules ??
      this.engine.cache<BoxedRuleSet>(
        'standard-simplification-rules',
        () => boxRules(this.engine, SIMPLIFY_RULES),
        (rules) => {
          for (const [lhs, rhs, _priority, _condition] of rules) {
            lhs.reset();
            rhs.reset();
          }
          return rules;
        }
      );

    let iterationCount = 0;
    let done = false;
    do {
      const newExpr = expr.replace(rules);
      if (newExpr !== null) {
        expr = cheapest(expr, newExpr);
        if (expr === newExpr) done = true;
      } else done = true; // no rules applied

      iterationCount += 1;
      // @debug-begin
      // if (iterationCount > 100) {
      //   console.log('Iterating... ', newExpr?.toJSON() ?? '()', expr.toJSON());
      // }
      // @debug-end
    } while (!done && iterationCount < this.engine.iterationLimit);

    // @debug-begin
    // if (iterationCount >= this.engine.iterationLimit) {
    //   console.error('Iteration Limit reached simplifying', this.toJSON());
    // }
    // @debug-end

    return cheapest(this, expr);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (options?.numericMode) {
      const h = this.head;

      //
      // Transform N(Integrate) into NIntegrate(), etc...
      //
      if (h === 'Integrate' || h === 'Limit')
        return this.engine
          .box(['N', this], { canonical: true })
          .evaluate(options);
    }
    if (!this.isCanonical) {
      this.engine.pushScope();
      const canonical = this.canonical;
      this.engine.popScope();
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.evaluate(options);
    }

    const def = this.functionDefinition;

    //
    // 2/ Thread if applicable
    //
    // If the function is threadable, iterate
    //
    if (
      def?.threadable &&
      this.ops!.some((x) => isFiniteIndexableCollection(x))
    ) {
      // If one of the arguments is an indexable collection, thread the function
      // Get the length of the longest sequence
      const length = Math.max(
        ...this._ops.map((x) => x.functionDefinition?.size?.(x) ?? 0)
      );

      // Zip
      const results: BoxedExpression[] = [];
      for (let i = 0; i <= length - 1; i++) {
        const args = this._ops.map((x) =>
          isFiniteIndexableCollection(x)
            ? at(x, (i % length) + 1) ?? this.engine.Nothing
            : x
        );
        results.push(this.engine._fn(this.head, args).evaluate(options));
      }

      if (results.length === 0) return this.engine.box(['Sequence']);
      if (results.length === 1) return results[0];
      return this.engine._fn('List', results);
    }

    //
    // 3/ Evaluate the applicable operands
    //
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.evaluate(options)
    );

    //
    // 4/ Inert? Just return the first argument.
    //
    if (def?.inert) return tail[0] ?? this;

    //
    // 5/ Is it an applied anonymous function?
    //    e.g. [["Add", "_", 1], 2]
    //
    let result: BoxedExpression | undefined | null = undefined;
    if (typeof this._head !== 'string') result = apply(this._head, tail);

    //
    // 6/ Call the `evaluate` or `N` handler
    //
    const sig = def?.signature;
    if (!result && sig) {
      const numericMode = options?.numericMode ?? false;
      const context = this.engine.swapScope(this.scope);
      if (numericMode && sig.N) result = sig.N!(this.engine, tail);
      if (!result && sig.evaluate) result = sig.evaluate!(this.engine, tail);
      this.engine.swapScope(context);
    }

    if (result) {
      const num = result.numericValue;
      if (num !== null) {
        if (!complexAllowed(this.engine) && num instanceof Complex)
          result = this.engine.NaN;
        else if (!bignumPreferred(this.engine) && num instanceof Decimal)
          result = this.engine.number(num.toNumber());
      }
    }
    return result ?? this.engine.fn(this._head, tail);
  }

  N(options?: NOptions): BoxedExpression {
    return this.evaluate({ ...options, numericMode: true });
  }

  solve(vars: string[]): null | BoxedExpression[] {
    if (vars.length !== 1) return null;
    const roots = findUnivariateRoots(this.simplify(), vars[0]);
    return roots;
  }
}

function makeNumericFunction(
  ce: IComputeEngine,
  head: string,
  semiOps: SemiBoxedExpression[],
  metadata?: Metadata
): BoxedExpression | null {
  let ops: BoxedExpression[] = [];
  if (head === 'Add' || head === 'Multiply')
    ops = checkNumericArgs(ce, ce.canonical(semiOps), { flatten: head });
  else if (
    head === 'Negate' ||
    head === 'Square' ||
    head === 'Sqrt' ||
    head === 'Exp' ||
    head === 'Ln'
  )
    ops = checkNumericArgs(ce, ce.canonical(semiOps), 1);
  else if (head === 'Divide' || head === 'Power')
    ops = checkNumericArgs(ce, ce.canonical(semiOps), 2);
  else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid)) return ce._fn(head, ops, metadata);

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (head === 'Add') return ce.add(ops, metadata);
  if (head === 'Negate') return ce.neg(ops[0], metadata);
  if (head === 'Multiply') return ce.mul(ops, metadata);
  if (head === 'Divide') return ce.div(ops[0], ops[1], metadata);
  if (head === 'Exp') return ce.pow(ce.E, ops[0], metadata);
  if (head === 'Power') return ce.pow(ops[0], ops[1], metadata);
  if (head === 'Square') return ce.pow(ops[0], 2, metadata);
  if (head === 'Sqrt') {
    const op = ops[0].canonical;
    // We preserve square roots of rationals as "exact" values
    if (isRational(op.numericValue)) return ce._fn('Sqrt', [op], metadata);

    return ce.pow(op, ce.Half, metadata);
  }
  if (head === 'Ln') return ce._fn('Ln', ops, metadata);

  return null;
}

export function makeCanonicalFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  ops: SemiBoxedExpression[],
  metadata?: Metadata
): BoxedExpression {
  //
  // Is the head an expression? For example, `['InverseFunction', 'Sin']`
  //
  if (typeof head !== 'string') {
    // We need a new scope to capture any locals that might get bound
    // while evaluating the head.
    ce.pushScope();
    head = head.evaluate().symbol ?? head;
    ce.popScope();
  }

  if (typeof head === 'string') {
    const result = makeNumericFunction(ce, head, ops, metadata);
    if (result) return result;
  } else {
    if (!head.isValid)
      return new BoxedFunction(
        ce,
        head,
        ops.map((x) => ce.box(x, { canonical: false })),
        { metadata, canonical: false }
      );
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupFunction(head);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    // @todo: should we create a def for it?
    return new BoxedFunction(
      ce,
      head,
      flattenSequence(ops.map((x) => ce.box(x))),
      { metadata, canonical: true }
    );
  }

  let xs: BoxedExpression[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (!shouldHold(def.hold, ops.length - 1, i)) {
      xs.push(ce.box(ops[i]));
    } else {
      const y = ce.box(ops[i], { canonical: false });
      if (y.head === 'ReleaseHold') xs.push(y.op1.canonical);
      else xs.push(y);
    }
  }

  const sig = def.signature;

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for validating
  // arguments, sorting them, applying involution and idempotent to
  // the expression, flatenning sequences and validating the signature
  // (domain and number of arguments)
  //
  if (sig.canonical) {
    try {
      const result = sig.canonical(ce, xs);
      if (result) return result;
    } catch (e) {
      console.error(e);
    }
    // The canonical handler gave up, return a non-canonical expression
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), d) -> f(a, b, c, d)
  //
  xs = flattenSequence(xs);
  if (def.associative) xs = flattenOps(xs, head as string);

  const adjustedArgs = adjustArguments(
    ce,
    xs,
    def.hold,
    def.threadable,
    sig.params,
    sig.optParams,
    sig.restParam
  );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) return ce._fn(head, adjustedArgs, metadata);

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (xs.length === 1 && xs[0].head === head) {
    // f(f(x)) -> x
    if (def.involution) return xs[0].op1;

    // f(f(x)) -> f(x)
    if (def.idempotent) xs = xs[0].ops!;
  }

  //
  // 5/ Sort the arguments
  //
  if (xs.length > 1 && def.commutative === true) xs = xs.sort(order);

  return ce._fn(head, xs, metadata);
}

/** Apply the function `f` to elements of `xs`, except to the elements
 * described by `skip`:
 * - `all`: don't apply f to any elements
 * - `none`: apply `f` to all elements
 * - `first`: apply `f` to all elements except the first
 * - `rest`: apply `f` to the first element, skip the  others
 * - 'last': apply `f` to all elements except the last
 * - 'most': apply `f` to the last elements, skip the others
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  xs: BoxedExpression[],
  skip: Hold,
  associativeHead: string,
  f: (x: BoxedExpression) => BoxedExpression | null
): BoxedExpression[] {
  if (xs.length === 0) return [];

  // f(a, f(b, c), d) -> f(a, b, c, d)
  xs = flattenOps(xs, associativeHead);

  //
  // Apply the hold as necessary
  //
  // @fastpath
  if (skip === 'all') return xs;
  if (skip === 'none') {
    const result: BoxedExpression[] = [];
    for (const x of xs) {
      const h = x.head;
      if (h === 'Hold') result.push(x);
      else {
        const op = h === 'ReleaseHold' ? x.op1 : x;
        if (op) {
          const y = f(op);
          if (y !== null) result.push(y);
        }
      }
    }
    return flattenOps(result, associativeHead);
  }

  const result: BoxedExpression[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].head === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].head === 'ReleaseHold') y = xs[i].op1;
      else if (!shouldHold(skip, xs.length - 1, i)) y = xs[i];
      else result.push(xs[i]);

      if (y) {
        const x = f(y);
        if (x !== null) result.push(x);
      }
    }
  }
  return flattenOps(result, associativeHead);
}

// @todo: allow selection of one signature amongst multiple
// function matchSignature(
//   ce: IComputeEngine,
//   def: BoxedFunctionDefinition,
//   tail: BoxedExpression[],
//   codomain?: BoxedExpression
// ): BoxedFunctionSignature | undefined {
//   return def.signature;
// }

/**
 * Considering an old (existing) expression and a new (simplified) one,
 * return the cheapest of the two, with a bias towards the new (which can
 * actually be a bit more expensive than the old one, and still be picked).
 */
function cheapest(
  oldExpr: BoxedExpression,
  newExpr: SemiBoxedExpression | null | undefined
): BoxedExpression {
  if (newExpr === null || newExpr === undefined) return oldExpr;
  if (oldExpr === newExpr) return oldExpr;

  const ce = oldExpr.engine;
  const boxedNewExpr = ce.box(newExpr);

  if (ce.costFunction(boxedNewExpr) <= 1.2 * ce.costFunction(oldExpr)) {
    // console.log(
    //   'Picked new' + boxedNewExpr.toString() + ' over ' + oldExpr.toString()
    // );
    return boxedNewExpr;
  }

  // console.log(
  //   'Picked old ' + oldExpr.toString() + ' over ' + newExpr.toString()
  // );
  return oldExpr;
}
