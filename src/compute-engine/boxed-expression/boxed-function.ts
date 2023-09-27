import Complex from 'complex.js';
import Decimal from 'decimal.js';

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
} from '../public';
import { findUnivariateRoots } from '../solve';
import { asFloat } from '../numerics/numeric';
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
import { validateNumericArgs, validateSignature } from './validate';
import { expand } from '../symbolic/expand';
import { apply } from '../function-utils';

/**
 * BoxedFunction
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
  private _codomain: BoxedDomain | undefined = undefined;

  // The cached result of applying the tail to the head. If the function is
  // not pure, its value is never cached.
  private _value: BoxedExpression | undefined;
  private _numericValue: BoxedExpression | undefined;

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

    if (options.canonical) this._canonical = this;

    this._scope = ce.context;
    this.bind();

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
    return this._ops[0] ?? this.engine.symbol('Nothing');
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.symbol('Nothing');
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.symbol('Nothing');
  }

  get isValid(): boolean {
    if (this._head === 'Error') return false;

    if (typeof this._head !== 'string' && !this._head.isValid) return false;

    return this._ops.every((x) => x.isValid);
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
      else if (!rhs.head || !this.head.isSame(rhs.head)) return false;
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

  bind(_scope?: RuntimeScope | null): void {
    // Unbind
    this._def = undefined;

    const head = this._head;
    if (!head || typeof head !== 'string') return;
    this._def = this.engine.lookupFunction(head);
  }

  unbind(): void {
    // Note: a non-canonical expression is never bound
    this._value = undefined;
    this._numericValue = undefined;
    // this._def = null;
  }

  get value(): BoxedExpression | undefined {
    if (!this.isCanonical || !this.isPure) return undefined;
    // Use cached value if the function is pure
    if (!this._value) this._value = this.evaluate();
    return this._value;
  }

  /** `isEqual` is mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    const s = signDiff(this, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;

    // Try to simplify the difference of the expressions
    const diff = this.engine.box(['Subtract', this, rhs]).simplify();
    if (diff.isZero) return true;

    return this.isSame(rhs);
  }

  isLess(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s < 0;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s <= 0;
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s > 0;
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s >= 0;
  }

  get isZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s === 0;
    return undefined;
    // @todo: use this.functionDefinition.range
  }

  get isNotZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s !== 0;
    return undefined;
    // @todo: use this.functionDefinition.range
  }

  get isOne(): boolean | undefined {
    return this.isEqual(this.engine._ONE);
  }

  get isNegativeOne(): boolean | undefined {
    return this.isEqual(this.engine._NEGATIVE_ONE);
  }

  // x > 0
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s > 0;
    return undefined;
  }
  // x <= 0
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s <= 0;
    return undefined;
  }
  // x < 0
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s < 0;
    return undefined;
  }
  // x >= 0
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s >= 0;
    return undefined;
  }

  get isNumber(): boolean | undefined {
    if (!this.domain) {
      debugger;
      console.log(this.domain);
    }
    return this.domain.isCompatible('Number');
  }
  get isInteger(): boolean | undefined {
    return this.domain.isCompatible('Integer');
  }
  get isRational(): boolean | undefined {
    return this.domain.isCompatible('RationalNumber');
  }
  get isAlgebraic(): boolean | undefined {
    return this.domain.isCompatible('AlgebraicNumber');
  }
  get isReal(): boolean | undefined {
    return this.domain.isCompatible('RealNumber');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain.isCompatible('ExtendedRealNumber');
  }
  get isComplex(): boolean | undefined {
    return this.domain.isCompatible('ComplexNumber');
  }
  get isImaginary(): boolean | undefined {
    return this.domain.isCompatible('ImaginaryNumber');
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    if (!this.isCanonical) return undefined;
    // @todo: if there is a this.functionDefinition.range, use it
    // @todo if inconclusive, and there is a this.def._sgn, call it

    // @todo: add sgn() function to FunctionDefinition
    const head = this.head;
    if (head === 'Negate') {
      const s = this._ops[0]?.sgn;
      if (s === undefined) return undefined;
      if (s === null) return null;
      return s === 0 ? 0 : s > 0 ? -1 : +1;
    }
    if (head === 'Multiply') {
      const total = this._ops.reduce((acc, x) => acc * (x.sgn ?? NaN), 1);
      if (isNaN(total)) return null;
      if (total > 0) return 1;
      if (total < 0) return -1;
      return 0;
    }
    if (head === 'Add') {
      let posCount = 0;
      let negCount = 0;
      let zeroCount = 0;
      const count = this._ops.length;
      for (const op of this._ops) {
        const s = op.sgn;
        if (s === null || s === undefined) break;
        if (s === 0) zeroCount += 1;
        if (s > 0) posCount += 1;
        if (s < 0) negCount += 1;
      }
      if (zeroCount === count) return 0;
      if (posCount === count) return 1;
      if (negCount === count) return -1;
      return null;
    }
    if (head === 'Divide') {
      const n = this._ops[0]?.sgn;
      const d = this._ops[1]?.sgn;
      if (n === null || d === null || n === undefined || d === undefined)
        return null;
      if (n === 0) return 0;
      if ((n > 0 && d > 0) || (n < 0 && d < 0)) return +1;
      return -1;
    }
    if (head === 'Square') {
      if (this._ops[0]?.isImaginary) return -1;
      if (this._ops[0]?.isZero) return 0;
      return +1;
    }
    if (head === 'Abs') {
      if (this._ops[0]?.isZero) return 0;
      return +1;
    }
    if (head === 'Sqrt') {
      if (this._ops[0]?.isZero) return 0;
      if (this._ops[0]?.isImaginary) return null;
      return +1;
    }
    // @todo: more functions...
    if (head === 'Power') {
    }
    if (head === 'Root') {
    }
    if (head === 'Ln') {
    }
    if (head === 'Floor') {
    }
    if (head === 'Ceil') {
    }
    if (head === 'Round') {
    }
    // @todo: trig functions, geometric functions

    const v = asFloat(this.N());
    if (v === null) return undefined;
    if (v === 0) return 0;
    if (v < 0) return -1;
    return +1;
  }

  //
  // AUTO-CANONICAL OPERATIONS
  //
  // The operations are automatically done on the canonical form of the
  // expression
  //

  get domain(): BoxedDomain {
    if (this._codomain !== undefined) return this._codomain;
    if (!this.canonical) return this.engine.domain('Anything');

    const ce = this.engine;

    let result: BoxedDomain | undefined = undefined;

    if (typeof this._head !== 'string') {
      result = this._head.domain.codomain ?? undefined;
    } else if (this._def) {
      const sig = this._def.signature;
      if (typeof sig.codomain === 'function')
        result = sig.codomain(ce, this._ops) ?? undefined;
      else result = sig.codomain ?? undefined;
    }

    result ??= ce.defaultDomain ?? ce.domain('Void');

    if (!result) {
      debugger;
      console.log(this.domain);
    }

    this._codomain = result;
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
            lhs.unbind();
            rhs.unbind();
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
    if (!this.isCanonical) {
      const canonical = this.canonical;
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.evaluate(options);
    }

    //
    // Swap to the lexical scope (the scope in which the expression was boxed)
    //
    // This will allow any asignments (or declaration) to be made in the
    // lexical scope, not the current scope.
    //

    const scope = this.engine.swapScope(this._scope);

    //
    // 3/ Evaluate the applicable operands
    //
    const def = this.functionDefinition;
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.evaluate(options)
    );

    //
    // 4/ Is it an anonymous function?
    //
    let result: BoxedExpression | undefined | null = undefined;
    if (typeof this._head !== 'string') {
      const expr = apply(this._head, tail);
      if (typeof expr.head !== 'string') result = expr;
      else result = expr.evaluate(options);
    }

    //
    // 5/ No def? Inert? We're done.
    //
    if (!result) {
      if (!def) result = this.engine.fn(this._head, tail);
      else if (def.inert) result = tail[0] ?? this;
    }
    //
    // 5/ Call the `evaluate` handler
    //
    result ??=
      def!.signature?.evaluate?.(this.engine, tail) ??
      this.engine.fn(this._head, tail);

    // Restore the scope and exit
    this.engine.swapScope(scope);
    return result;
  }

  N(options?: NOptions): BoxedExpression {
    //
    // 1/ Use canonical form
    //
    if (this._numericValue) return this._numericValue;
    if (this.engine.strict && !this.isValid) return this;
    if (!this.isCanonical) {
      const canonical = this.canonical;
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.N(options);
    }

    const scope = this.engine.swapScope(this._scope);

    //
    // 2/ Evaluate the applicable operands
    //

    const def = this.functionDefinition;
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.N(options)
    );

    let result: BoxedExpression | undefined | null = undefined;

    //
    // 3/ Is it a function expression
    //
    if (typeof this._head !== 'string') {
      const expr = apply(this._head, tail);
      if (typeof expr.head !== 'string') result = expr;
      else result = expr.N(options);
    }

    //
    // 4/ No def? Inert? We're done.
    //
    if (!def) result = this.engine.fn(this._head, tail);
    else if (def.inert) result = tail[0] ?? this;

    //
    // 5/ Call `N` handler or fallback to `evaluate`
    //
    const sig = def?.signature;

    result ??=
      sig?.N?.(this.engine, tail) ??
      this.engine.fn(this._head, tail).evaluate();

    this.engine.swapScope(scope);

    const num = result.numericValue;
    if (num !== null) {
      if (!complexAllowed(this.engine) && num instanceof Complex)
        result = this.engine._NAN;
      else if (!bignumPreferred(this.engine) && num instanceof Decimal)
        result = this.engine.number(num.toNumber());
    }

    if (this.isPure) this._numericValue = result;

    return result;
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
    ops = validateNumericArgs(
      ce,
      flattenOps(flattenSequence(ce.canonical(semiOps)), head)
    );
  else if (head === 'Negate' || head === 'Square' || head === 'Sqrt')
    ops = validateNumericArgs(ce, flattenSequence(ce.canonical(semiOps)), 1);
  else if (head === 'Divide' || head === 'Power')
    ops = validateNumericArgs(ce, flattenSequence(ce.canonical(semiOps)), 2);
  else return null;

  // If some of the arguments are not valid, make a non-canonical expression
  if (!ops.every((x) => x.isValid))
    return new BoxedFunction(ce, head, ops, { metadata, canonical: false });

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (head === 'Add') return ce.add(ops, metadata);
  if (head === 'Negate') return ce.neg(ops[0] ?? ce.error('missing'), metadata);
  if (head === 'Multiply') return ce.mul(ops, metadata);
  if (head === 'Divide') return ce.div(ops[0], ops[1], metadata);
  if (head === 'Power') return ce.pow(ops[0], ops[1], metadata);
  if (head === 'Square') return ce.pow(ops[0], ce.number(2), metadata);
  if (head === 'Sqrt') {
    const op = ops[0].canonical;
    if (isRational(op.numericValue))
      return new BoxedFunction(ce, 'Sqrt', [op], { metadata, canonical: true });

    return ce.pow(op, ce._HALF, metadata);
  }

  // if (head === 'Pair') return ce.pair(ops[0], ops[1], metadata);
  // if (head === 'Tuple') return ce.tuple(ops, metadata);

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
  if (typeof head !== 'string') head = head.evaluate().symbol ?? head;

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

  if (!xs.every((x) => x.isValid))
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });

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

  // If some of the arguments are not valid, can't make a canonical expression
  if (!xs.every((x) => x.isValid))
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });

  const invalidArgs = validateSignature(sig.domain, xs);

  if (invalidArgs)
    return new BoxedFunction(ce, head, invalidArgs, {
      metadata,
      canonical: false,
    });

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

  return new BoxedFunction(ce, head, xs, { metadata, canonical: true });
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
  skip: 'all' | 'none' | 'first' | 'rest' | 'last' | 'most',
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

function shouldHold(
  skip: 'all' | 'none' | 'first' | 'rest' | 'last' | 'most',
  count: number,
  index: number
): boolean {
  if (skip === 'all') return true;

  if (skip === 'none') return false;

  if (skip === 'first') return index === 0;

  if (skip === 'rest') return index !== 0;

  if (skip === 'last') return index === count;

  if (skip === 'most') return index !== count;

  return true;
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
