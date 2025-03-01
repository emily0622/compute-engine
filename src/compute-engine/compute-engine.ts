import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';

import { Expression, MathJsonNumber } from '../math-json/math-json-format';

import { LatexSyntax } from './latex-syntax/latex-syntax';
import type {
  LibraryCategory,
  LatexDictionaryEntry,
  LatexString,
  NumberFormattingOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/public';

import { assume } from './assume';

import { MACHINE_PRECISION, NUMERIC_TOLERANCE } from './numerics/numeric';
import {
  AssumeResult,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  IComputeEngine,
  IdentifierDefinitions,
  ExpressionMapInterface,
  NumericMode,
  Pattern,
  RuntimeScope,
  Scope,
  SemiBoxedExpression,
  SymbolDefinition,
  BoxedRuleSet,
  Rule,
  JsonSerializationOptions,
  ComputeEngineStats,
  Metadata,
  BoxedDomain,
  DomainExpression,
  FunctionDefinition,
  Rational,
  BoxedSubstitution,
  AssignValue,
  DomainLiteral,
  ArrayValue,
  CanonicalForm,
} from './public';
import { box, boxFunction, boxNumber } from './boxed-expression/box';
import {
  setIdentifierDefinitions,
  getStandardLibrary,
  isSymbolDefinition,
  isFunctionDefinition,
} from './library/library';
import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import { BoxedPattern } from './boxed-expression/boxed-patterns';
import { latexString } from './boxed-expression/utils';
import { boxRules } from './rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber } from './boxed-expression/boxed-number';
import { _BoxedSymbolDefinition } from './boxed-expression/boxed-symbol-definition';
import { canonicalPower } from './library/arithmetic-power';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { canonicalMultiply } from './library/arithmetic-multiply';
import { canonicalAdd } from './library/arithmetic-add';
import { canonicalDivide } from './library/arithmetic-divide';
import {
  BoxedSymbol,
  makeCanonicalSymbol,
} from './boxed-expression/boxed-symbol';
import { _BoxedDomain, isDomain } from './boxed-expression/boxed-domain';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import { isValidIdentifier, validateIdentifier } from '../math-json/utils';
import {
  makeFunctionDefinition,
  _BoxedFunctionDefinition,
} from './boxed-expression/boxed-function-definition';
import {
  inverse,
  isBigRational,
  isMachineRational,
  isRational,
  isRationalOne,
  isRationalZero,
} from './numerics/rationals';
import { canonicalNegate } from './symbolic/negate';
import { flattenOps, flattenSequence } from './symbolic/flatten';
import { bigint } from './numerics/numeric-bigint';
import { parseFunctionSignature } from './function-utils';
import { CYAN, INVERSE_RED, RESET, YELLOW } from '../common/ansi-codes';
import {
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from './library/domains';
import { canonical } from './symbolic/utils';
import { domainToSignature } from './domain-utils';

/**
 *
 * To use the CortexJS Compute Engine, create a `ComputeEngine` instance, or if using a
 * mathfield, use the default Compute Engine instance from the `MathfieldElement` class: `ce = MathfieldElement.computeEngine`.
 *
 * Use the instance to create boxed expressions with `ce.parse()` and `ce.box()`.
 *
 *
 * ```ts
 * const ce = new ComputeEngine();
 * let expr = ce.parse("e^{i\\pi}");
 * console.log(expr.N().latex);
 * // ➔ "-1"
 *
 * expr = ce.box(["Expand", ["Power", ["Add", "a", "b"], 2]]);
 * console.log(expr.evaluate().latex);
 * // ➔ "a^2 +  2ab + b^2"
 * ```
 */
export class ComputeEngine implements IComputeEngine {
  // Common domains
  readonly Anything: BoxedDomain;
  readonly Void: BoxedDomain;
  readonly Strings: BoxedDomain;
  readonly Booleans: BoxedDomain;
  readonly Numbers: BoxedDomain;

  // Common symbols
  readonly True: BoxedExpression;
  readonly False: BoxedExpression;
  readonly Pi: BoxedExpression;
  readonly E: BoxedExpression;
  readonly Nothing: BoxedExpression;

  // Common numbers
  readonly Zero: BoxedExpression;
  readonly One: BoxedExpression;
  readonly Half: BoxedExpression;
  readonly NegativeOne: BoxedExpression;
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

  /** @internal */
  _BIGNUM_NAN: Decimal;
  /** @internal */
  _BIGNUM_ZERO: Decimal;
  /** @internal */
  _BIGNUM_ONE: Decimal;
  /** @internal */
  _BIGNUM_TWO: Decimal;
  /** @internal */
  _BIGNUM_HALF: Decimal;
  /** @internal */
  _BIGNUM_PI: Decimal;
  /** @internal */
  _BIGNUM_NEGATIVE_ONE: Decimal;

  /** @internal */
  private _precision: number;
  /** @internal */
  private _numericMode: NumericMode;
  /** @internal */
  private _latexSyntax?: LatexSyntax; // To parse rules as LaTeX

  /** @internal */
  private _tolerance: number;
  /** @internal */
  private _bignumTolerance: Decimal;

  /** @internal */
  private _cache: {
    [key: string]: {
      value: any;
      build: () => any;
      purge: (v: unknown) => void;
    };
  } = {};

  /** @internal */
  private _stats: ComputeEngineStats & { [key: string]: unknown };

  /** @internal */
  private _cost?: (expr: BoxedExpression) => number;

  /** @internal */
  private _jsonSerializationOptions: JsonSerializationOptions;

  /**
   * During certain operations  (serializing to LaTeX, constructing error
   * messages) we need to use a "raw" JSON serialization without any customization. Setting the `_useRawJsonSerializationOptions` will bypass
   * the `_jsonSerializationOptions` and use `_rawJsonSerializationOptions`
   * instead
   * @internal */
  private _useRawJsonSerializationOptions: boolean;
  private _rawJsonSerializationOptions: JsonSerializationOptions;

  /** @internal */
  private _commonSymbols: { [symbol: string]: null | BoxedExpression } = {
    True: null,
    False: null,

    All: null,
    Nothing: null,
    None: null,
    Undefined: null,
    // Function: null,

    Pi: null,
    ImaginaryUnit: null,
    ExponentialE: null,
  };
  /** @internal */
  private _commonNumbers: { [num: number]: null | BoxedExpression } = {
    '-5': null,
    '-4': null,
    '-3': null,
    '-2': null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
    8: null,
    9: null,
    10: null,
    11: null,
    12: null,
    36: null,
  };
  /** @internal */

  private _commonDomains: Partial<{
    [dom in DomainLiteral]: null | BoxedDomain;
  }> = {
    Anything: null,
    Void: null,
    NothingDomain: null,
    Booleans: null,
    Strings: null,
    Domains: null,
    Symbols: null,
    Integers: null,
    RationalNumbers: null,
    AlgebraicNumbers: null,
    RealNumbers: null,
    ExtendedRealNumbers: null,
    ImaginaryNumbers: null,
    ComplexNumbers: null,
    ExtendedComplexNumbers: null,
    Numbers: null,
    PositiveIntegers: null,
    TranscendentalNumbers: null,
    PositiveNumbers: null,
    Functions: null, // (Anything*) -> Anything
    NumericFunctions: null, // (Numbers+) -> Numbers
    RealFunctions: null, // (ExtendedRealNumbers+) -> ExtendRealNumbers
    LogicOperators: null, // (Booleans+) -> Boolean
    Predicates: null, // (Anything+) -> Booleans
  };

  /**
   * The current scope.
   *
   * A **scope** stores the definition of symbols and assumptions.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   * The `ce.context` property represents the current scope.
   *
   */
  context: RuntimeScope | null;

  /** In strict mode (the default) the Compute Engine performs
   * validation of domains and signature and may report errors.
   *
   * When strict mode is off, results may be incorrect or generate JavaScript
   * errors if the input is not valid.
   *
   */
  strict: boolean;

  /** Absolute time beyond which evaluation should not proceed.
   * @internal
   */
  deadline?: number;

  /**
   * Return identifier tables suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * An identifier table defines how the symbols and function names in a
   * MathJSON expression should be interpreted, i.e. how to evaluate and
   * manipulate them.
   *
   */
  static getStandardLibrary(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): readonly IdentifierDefinitions[] {
    return getStandardLibrary(categories);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Identifier tables define functions and symbols (in `options.ids`).
   * If no table is provided the MathJSON Standard Library is used (`ComputeEngine.getStandardLibrary()`)
   *
   * The LaTeX syntax dictionary is defined in `options.latexDictionary`.
   *
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include some basic definitions such
   * as domains (`Booleans`, `Numbers`, etc...) that are used by later
   * dictionaries.
   *
   * @param options.numericMode The default mode is `"auto"`. Use `"machine"`
   * to perform numeric calculations using 64-bit floats. Use `"bignum"` to
   * perform calculations using arbitrary precision floating point numbers.
   * Use `"auto"` or `"complex"` to allow calculations on complex numbers.
   *
   * @param options.numericPrecision Specific how many digits of precision
   * for the numeric calculations. Default is 100.
   *
   * @param options.tolerance If the absolute value of the difference of two
   * numbers is less than `tolerance`, they are considered equal. Used by
   * `chop()` as well.
   */
  constructor(options?: {
    numericMode?: NumericMode;
    numericPrecision?: number;
    ids?: readonly IdentifierDefinitions[];
    tolerance?: number;
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    this._jsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      precision: 'max',
      repeatingDecimals: true,
    };

    this._useRawJsonSerializationOptions = false;
    // These options are not customizable...
    this._rawJsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      precision: 'max',
      repeatingDecimals: false,
    };

    this._stats = {
      highwaterMark: 0,
      symbols: new Set<BoxedExpression>(),
      expressions: new Set<BoxedExpression>(),
    };

    // Set the default precision for `bignum` calculations
    this._numericMode = options?.numericMode ?? 'auto';
    this._precision = Math.max(
      options?.numericPrecision ?? 100,
      Math.floor(MACHINE_PRECISION)
    );

    this._bignum = Decimal.clone({ precision: this._precision });

    this.tolerance = options?.tolerance ?? NUMERIC_TOLERANCE;

    this.Zero = new BoxedNumber(this, 0);
    this.One = new BoxedNumber(this, 1);
    this.Half = new BoxedNumber(this, [1, 2]);
    this.NegativeOne = new BoxedNumber(this, -1);
    this.NaN = new BoxedNumber(this, Number.NaN);
    this.PositiveInfinity = new BoxedNumber(this, Number.POSITIVE_INFINITY);
    this.NegativeInfinity = new BoxedNumber(this, Number.NEGATIVE_INFINITY);
    this.I = new BoxedNumber(this, Complex.I);
    this.ComplexInfinity = new BoxedNumber(this, Complex.INFINITY);

    // Reset the caches/create numeric constants
    this.reset();

    //
    // The first, topmost, scope contains additional info
    //
    this.context = {
      assumptions: new ExpressionMap(),
      timeLimit: 2.0, // execution time limit: 2.0 seconds
      memoryLimit: 1.0, // memory limit: 1.0 megabyte
      recursionLimit: 1024,
      iterationLimit: Number.POSITIVE_INFINITY,
    } as RuntimeScope;

    for (const table of ComputeEngine.getStandardLibrary('domains'))
      setIdentifierDefinitions(this, table);

    // Patch-up any missing definitions (domains that were
    // 'forward-declared')
    for (const d of Object.keys(this._commonDomains)) {
      if (this._commonDomains[d] && !this._commonDomains[d]!.symbolDefinition)
        this._commonDomains[d]!.bind();
      else {
        this._commonDomains[d] = new _BoxedDomain(
          this,
          DOMAIN_ALIAS[d] ?? (d as DomainLiteral)
        );
      }
    }

    this.Anything = this._commonDomains.Anything!;
    this.Void = this._commonDomains.Void!;
    this.Strings = this._commonDomains.Strings!;
    this.Booleans = this._commonDomains.Booleans!;
    this.Numbers = this._commonDomains.Numbers!;

    const tables = options?.ids ?? ComputeEngine.getStandardLibrary();
    for (const table of tables) setIdentifierDefinitions(this, table);

    // Populate the table of common symbols
    // (they should be in the global context)
    for (const sym of Object.keys(this._commonSymbols)) {
      const boxedSymbol = new BoxedSymbol(this, sym, { canonical: true });
      boxedSymbol.bind();
      this._commonSymbols[sym] = boxedSymbol;
    }

    this.True = this._commonSymbols.True!;
    this.False = this._commonSymbols.False!;
    this.Pi = this._commonSymbols.Pi!;
    this.E = this._commonSymbols.ExponentialE!;
    this.Nothing = this._commonSymbols.Nothing!;

    // Push a fresh scope to protect global definitions:
    // this will be the "user" scope
    this.pushScope();
  }

  get latexDictionary(): readonly LatexDictionaryEntry[] {
    return this.latexSyntax.dictionary;
  }

  set latexDictionary(dic: readonly LatexDictionaryEntry[]) {
    this.latexSyntax.dictionary = dic;
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  reset() {
    console.assert(this._bignum);

    // Recreate the bignum constants (they depend on the engine's precision)
    this._BIGNUM_NEGATIVE_ONE = this.bignum(-1);
    this._BIGNUM_NAN = this.bignum(NaN);
    this._BIGNUM_ZERO = this.bignum(0);
    this._BIGNUM_ONE = this.bignum(1);
    this._BIGNUM_TWO = this.bignum(2);
    this._BIGNUM_HALF = this._BIGNUM_ONE.div(this._BIGNUM_TWO);
    this._BIGNUM_PI = this._BIGNUM_NEGATIVE_ONE.acos();

    // Reset all the known expressions/symbols
    const symbols = this._stats.symbols.values();
    const expressions = this._stats.expressions!.values();
    this._stats.symbols = new Set<BoxedExpression>();
    this._stats.expressions = new Set<BoxedExpression>();
    for (const s of symbols) s.reset();
    for (const s of expressions) s.reset();

    // Reset all the common  expressions (probably not necessary)
    for (const d of Object.values(this._commonDomains)) d?.reset();
    for (const d of Object.values(this._commonSymbols)) d?.reset();

    // Reset all the definitions
    let scope = this.context;
    while (scope) {
      if (scope.ids) for (const [_k, v] of scope.ids) v.reset();

      // @todo purge assumptions
      scope = scope.parentScope ?? null;
    }

    // Purge any caches
    for (const k of Object.keys(this._cache))
      if (this._cache[k].value) {
        if (!this._cache[k].purge) delete this._cache[k];
        else this._cache[k].value = this._cache[k].purge(this._cache[k].value);
      }
  }

  /** @internal */
  _register(_expr: BoxedExpression): void {
    // @debug
    // if (this._stats.expressions === null) return;
    // if (expr.symbol) {
    //   console.assert(!this._stats.symbols.has(expr));
    //   this._stats.symbols.add(expr);
    // } else {
    //   console.assert(!this._stats.expressions.has(expr));
    //   this._stats.expressions.add(expr);
    // }

    this._stats.highwaterMark += 1;
  }

  /** @internal */
  _unregister(_expr: BoxedExpression): void {
    // @debug
    // if (this._stats.expressions === null) return;
    // if (expr.symbol) {
    //   console.assert(this._stats.symbols.has(expr));
    //   this._stats.symbols.delete(expr);
    // } else {
    //   console.assert(this._stats.expressions.has(expr));
    //   this._stats.expressions.delete(expr);
    // }
  }

  get stats(): ComputeEngineStats {
    const expressions = this._stats.expressions;
    this._stats.expressions = null;

    // @debug-begin
    // const uniques = new Map<string, number>();
    // for (const x of expressions!) {
    //   const latex = x.toJSON();
    //   uniques.set(latex, (uniques.get(latex) ?? 0) + 1);
    // }

    // const top10 = [...uniques.entries()]
    //   .sort(([_k1, c1], [_k2, c2]) => c2 - c1)
    //   .slice(0, 30);

    // const dupes = new Map<string, number>();
    // for (const x of this._stats.symbols)
    //   dupes.set(x.symbol!, (dupes.get(x.symbol!) ?? 0) + 1);

    // const topDupes = [...dupes.entries()]
    //   .sort(([_k1, c1], [_k2, c2]) => c2 - c1)
    //   .filter(([_k, c]) => c > 1)
    //   .slice(0, 30);

    // @debug-end

    this._stats.expressions = expressions;

    return {
      ...this._stats,
      // _dupeSymbols: topDupes,
      // _popularExpressions: top10,
    } as ComputeEngineStats;
  }

  /** @internal */
  _bignum: Decimal.Constructor;

  /** The precision, or number of significant digits, of numeric
   * calculations when the numeric mode is `"auto"` or `"bignum"`.
   *
   * To make calculations using more digits, at the cost of expanded memory
   * usage and slower computations, set the `precision` higher.
   *
   * If the numeric mode is not `"auto"` or `"bignum"`, it is set to `"auto"`.
   *
   * Trigonometric operations are accurate for precision up to 1,000.
   *
   */
  get precision(): number {
    if (this._numericMode === 'machine' || this._numericMode === 'complex')
      return Math.floor(MACHINE_PRECISION);
    return this._precision;
  }

  set precision(p: number | 'machine') {
    if (p === 'machine') p = Math.floor(MACHINE_PRECISION);
    const currentPrecision = this._precision;

    if (p === currentPrecision) return;

    if (typeof p !== 'number' || p <= 0)
      throw Error('Expected "machine" or a positive number');

    // Set the display precision as requested.
    // It may be less than the effective precision, which is never less than 15
    this._latexSyntax?.updateOptions({
      precision: p,
      avoidExponentsInRange: [-6, p],
    });

    this._precision = Math.max(p, Math.floor(MACHINE_PRECISION));

    if ((this.jsonSerializationOptions.precision as number) > this._precision)
      this.jsonSerializationOptions = { precision: this._precision };

    if (
      this._numericMode !== 'auto' &&
      this._numericMode !== 'bignum' &&
      this._precision > Math.floor(MACHINE_PRECISION)
    )
      this._numericMode = 'auto';

    this._bignum = this._bignum.config({ precision: this._precision });

    // Reset the caches
    // (the values in the cache depend on the current precision)
    this.reset();
  }

  get numericMode(): NumericMode {
    return this._numericMode;
  }

  set numericMode(f: NumericMode) {
    if (f === this._numericMode) return;

    if (typeof f !== 'string') throw Error('Expected a string');

    this._numericMode = f;
    if (f === 'complex' || f === 'machine')
      this._precision = Math.floor(MACHINE_PRECISION);

    // Make sure the display precision is not larger than the computation precision
    if (
      this._latexSyntax &&
      this.latexSyntax.options.precision > this._precision
    )
      this.latexSyntax.updateOptions({ precision: this._precision });

    if ((this.jsonSerializationOptions.precision as number) > this._precision)
      this.jsonSerializationOptions = { precision: this._precision };

    // Reset the caches: the values in the cache depend on the numeric mode)
    this.reset();
  }

  /** @experimental */
  get timeLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.timeLimit !== undefined) return scope.timeLimit;
      scope = scope.parentScope ?? null;
    }
    return 2.0; // 2s
  }
  /** @experimental */
  get iterationLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.iterationLimit !== undefined) return scope.iterationLimit;
      scope = scope.parentScope ?? null;
    }
    return 1024;
  }
  /** @experimental */
  get recursionLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.recursionLimit !== undefined) return scope.recursionLimit;
      scope = scope.parentScope ?? null;
    }
    return 1024;
  }

  /**
   * Values smaller than the tolerance are considered to be zero for the
   * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
   * equal to `a`.
   */
  get tolerance(): number {
    return this._tolerance;
  }
  set tolerance(val: number) {
    if (typeof val === 'number' && Number.isFinite(val))
      this._tolerance = Math.max(val, 0);
    else this._tolerance = NUMERIC_TOLERANCE;
    this._bignumTolerance = this.bignum(this._tolerance);
  }

  /** Replace a number that is close to 0 with the exact integer 0.
   *
   * How close to 0 the number has to be to be considered 0 is determined by {@link tolerance}.
   */
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex {
    if (typeof n === 'number' && Math.abs(n) <= this._tolerance) return 0;

    if (n instanceof Decimal && n.abs().lte(this._bignumTolerance)) return 0;

    if (
      n instanceof Complex &&
      Math.abs(n.re) <= this._tolerance &&
      Math.abs(n.im) <= this._tolerance
    )
      return 0;

    return n;
  }

  /** Create an arbitrary precision number. 
   * 
   * The return value is an object with methods to perform arithmetic
   * operations:
   * - `toNumber()`: convert to a JavaScript `number` with potential loss of precision
   * - `add()`
   * - `sub()`
   * - `neg()` (unary minus)
   * - `mul()`
   * - `div()`
   * - `pow()`
   * - `sqrt()` (square root)
   * - `cbrt()` (cube root)
   * - `exp()`  (e^x)
   * - `log()` 
   * - `ln()` (natural logarithm)
   * - `mod()`

   * - `abs()`
   * - `ceil()`
   * - `floor()`
   * - `round()`

   * - `equals()`
   * - `gt()`
   * - `gte()`
   * - `lt()`
   * - `lte()`
   * 
   * - `cos()`
   * - `sin()`
   * - `tanh()`
   * - `acos()`
   * - `asin()`
   * - `atan()`
   * - `cosh()`
   * - `sinh()`
   * - `acosh()`
   * - `asinh()`
   * - `atanh()`
   * 
   * - `isFinite()`
   * - `isInteger()`
   * - `isNaN()`
   * - `isNegative()`
   * - `isPositive()`
   * - `isZero()`
   * - `sign()` (1, 0 or -1)
   * 
   */
  bignum(a: Decimal.Value | bigint): Decimal {
    if (typeof a === 'bigint') return new this._bignum(a.toString());
    try {
      return new this._bignum(a);
    } catch (e) {
      console.error(e);
    }
    return this._BIGNUM_NAN;
  }

  /** Create a complex number.
   * The return value is an object with methods to perform arithmetic
   * operations:
   * - `re` (real part, as a JavaScript `number`)
   * - `im` (imaginary part, as a JavaScript `number`)
   * - `add()`
   * - `sub()`
   * - `neg()` (unary minus)
   * - `mul()`
   * - `div()`
   * - `pow()`
   * - `sqrt()` (square root)
   * - `exp()`  (e^x)
   * - `log()` 
   * - `ln()` (natural logarithm)
   * - `mod()`

   * - `abs()`
   * - `ceil()`
   * - `floor()`
   * - `round()`

   * - `arg()` the angle of the complex number
   * - `inverse()` the inverse of the complex number 1/z
   * - `conjugate()` the conjugate of the complex number

   * - `equals()`
   * 
   * - `cos()`
   * - `sin()`
   * - `tanh()`
   * - `acos()`
   * - `asin()`
   * - `atan()`
   * - `cosh()`
   * - `sinh()`
   * - `acosh()`
   * - `asinh()`
   * - `atanh()`
   * 
   * - `isFinite()`
   * - `isNaN()`
   * - `isZero()`
   * - `sign()` (1, 0 or -1)
   */
  complex(a: number | Decimal | Complex, b?: number | Decimal): Complex {
    if (a instanceof Decimal) a = a.toNumber();
    if (b instanceof Decimal) b = b.toNumber();
    return new Complex(a, b);
  }

  isBignum(a: unknown): a is Decimal {
    return a instanceof Decimal;
  }

  isComplex(a: unknown): a is Complex {
    return a instanceof Complex;
  }

  private get latexSyntax(): LatexSyntax {
    if (!this._latexSyntax) {
      const precision = this.precision;
      this._latexSyntax = new LatexSyntax({
        computeEngine: this,
        precision,
        avoidExponentsInRange: [-6, precision],
        onError: (err) => {
          throw new Error(JSON.stringify(err[0].message));
        },
      });
    }
    return this._latexSyntax;
  }

  static getLatexDictionary(
    domain: LibraryCategory | 'all' = 'all'
  ): readonly Readonly<object>[] {
    return LatexSyntax.getDictionary(domain);
  }

  set costFunction(fn: ((expr: BoxedExpression) => number) | undefined) {
    if (typeof fn !== 'function') this._cost = DEFAULT_COST_FUNCTION;
    this._cost = fn;
  }

  get costFunction(): (expr: BoxedExpression) => number {
    return this._cost ?? DEFAULT_COST_FUNCTION;
  }

  /**
   * Return a matching symbol definition, starting with the current
   * scope and going up the scope chain. Prioritize finding a match by
   * wikidata, if provided.
   */
  lookupSymbol(
    symbol: string,
    wikidata?: string,
    scope?: RuntimeScope
  ): undefined | BoxedSymbolDefinition {
    // @fastpath
    if (!this.strict) {
      scope ??= this.context ?? undefined;
      while (scope) {
        const def = scope.ids?.get(symbol);
        if (def && def instanceof _BoxedSymbolDefinition) return def;
        scope = scope.parentScope;
      }
      return undefined;
    }

    if (typeof symbol !== 'string') throw Error('Expected a string');

    if (symbol.length === 0 || !this.context) return undefined;

    const rootScope = scope ?? this.context;

    // Try to find a match by wikidata
    if (wikidata) {
      scope = rootScope;
      while (scope) {
        if (scope.ids)
          for (const [_, d] of scope.ids) {
            if (d instanceof _BoxedSymbolDefinition && d.wikidata === wikidata)
              return d;
          }
        scope = scope.parentScope;
      }
    }
    // Match by name
    scope = rootScope;
    while (scope) {
      const def = scope.ids?.get(symbol);
      if (def instanceof _BoxedSymbolDefinition) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Return the definition for a function matching this head.
   *
   * Start looking in the current context, than up the scope chain.
   *
   * This is a very rough lookup, since it doesn't account for the domain
   * of the argument or the codomain. However, it is useful during parsing
   * to differentiate between symbols that might represent a function application, e.g. `f` vs `x`.
   */
  lookupFunction(
    head: string | BoxedExpression,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition {
    if (typeof head !== 'string') return undefined;

    if (!this.context) return undefined;

    scope ??= this.context;
    while (scope) {
      const def = scope.ids?.get(head);
      if (def instanceof _BoxedFunctionDefinition) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Associate a new definition to a symbol in the current context.
   *
   * If a definition existed previously, it is replaced.
   *
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition {
    if (!this.context)
      throw Error('Symbol cannot be defined: no scope available');

    if (name.length === 0 || !isValidIdentifier(name))
      throw Error(`Invalid identifier "${name}": ${validateIdentifier(name)}}`);

    return this._defineSymbol(name, def);
  }

  _defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition {
    this.context!.ids ??= new Map();

    const boxedDef = new _BoxedSymbolDefinition(this, name, def);
    if (boxedDef.name) this.context!.ids.set(boxedDef.name, boxedDef);

    return boxedDef;
  }

  /**
   * Associate a new delookupSymbolfinition to a function in the current context.
   *
   * If a definition existed previously, it is replaced.
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition {
    if (!this.context)
      throw Error('Function cannot be defined: no scope available');
    if (name.length === 0 || !isValidIdentifier(name))
      throw Error(`Invalid identifier "${name}": ${validateIdentifier(name)}}`);

    return this._defineFunction(name, def);
  }

  _defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition {
    this.context!.ids ??= new Map();

    const boxedDef = makeFunctionDefinition(this, name, def);

    if (boxedDef.name) this.context!.ids.set(boxedDef.name, boxedDef);

    return boxedDef;
  }

  /**
   *
   * Create a new scope and add it to the top of the scope stack
   *
   * The `scope` argument can be used to specify custom precision,
   * etc... for this scope
   *
   *
   */
  pushScope(scope?: Partial<Scope>): ComputeEngine {
    if (this.context === null) throw Error('No parent scope available');
    this.context = {
      timeLimit: this.context.timeLimit,
      memoryLimit: this.context.memoryLimit,
      recursionLimit: this.context.recursionLimit,
      iterationLimit: this.context.iterationLimit,
      ...(scope ?? {}),
      parentScope: this.context,
      // We always copy the current assumptions in the new scope.
      // This make is much easier to deal with 'inherited' assumptions
      // (and potentially modifying them later) without having to walk back
      // into parent contexts. In other words, calling `ce.forget()` will
      // forget everything **in the current scope**. When exiting the scope,
      // the previous assumptions are restored.
      assumptions: new ExpressionMap(this.context.assumptions),
    };
    return this;
  }

  /** Remove the most recent scope from the scope stack, and set its
   *  parent scope as current. */
  popScope(): ComputeEngine {
    if (!this.context) throw Error('No scope available');

    this.context = this.context.parentScope ?? null;

    console.assert(this.context);
    return this;
  }

  /** Set the current scope, return the previous scope. */
  swapScope(scope: RuntimeScope | null): RuntimeScope | null {
    const oldScope = this.context;
    this.context = scope;
    console.assert(this.context);
    return oldScope;
  }

  /**
   * Reset the value of any identifiers that have been assigned a value
   * in the current scope.
   * @internal */
  resetContext(): void {
    // Iterate over all the identifiers of the current scope
    // and reset them
    if (!this.context) return;
    for (const [_, def] of this.context.ids ?? []) {
      if (def instanceof _BoxedSymbolDefinition) {
        if (!def.constant) def.value = undefined;
      } else if (def instanceof _BoxedFunctionDefinition) {
        const sig = def.signature;
        def.signature = {
          ...sig,
          evaluate: undefined,
          N: undefined,
          simplify: undefined,
          canonical: undefined,
        };
      }
    }
  }

  /** @internal */
  _printScope(
    options?: { details?: boolean; maxDepth?: number },
    scope?: RuntimeScope | null,
    depth = 0
  ): RuntimeScope | null {
    options ??= { details: false, maxDepth: 1 };
    scope ??= this.context;
    if (!scope) return null;
    if (options.maxDepth && depth > options.maxDepth) return null;
    const undef = `${YELLOW}[undefined]${RESET}`;
    if (depth === 0) {
      console.group('current scope - level 0');
    } else {
      console.groupCollapsed(
        !scope.parentScope
          ? `root scope - level ${depth}`
          : `scope - level ${depth}`
      );
    }
    if (scope.ids) {
      let count = 0;
      for (const [k, v] of scope.ids) {
        const id = `${CYAN}${k}${RESET}`;
        try {
          if (v instanceof _BoxedSymbolDefinition) {
            const val = v.value?.isValid
              ? v.value.toString()
              : v.value
              ? `${INVERSE_RED}${v.value!.toString()}${RESET}`
              : undef;
            console.info(`${id}: ${v.domain?.toString() ?? undef} = ${val}`);
          } else if (v instanceof _BoxedFunctionDefinition) {
            if (typeof v.signature.evaluate === 'function')
              console.info(
                `${id}(): ${
                  options.details
                    ? v.signature.evaluate.toString()
                    : '[native-code]'
                }`
              );
            else if (v.signature.evaluate === undefined)
              console.info(`${id}(): ${undef}`);
            else console.info(`${id}(): ${v.toString()}`);
          }
          if (count === 11)
            console.groupCollapsed(`... and ${scope.ids.size - count} more`);
          count += 1;
        } catch (err) {
          console.info(`${id}: ${INVERSE_RED}${err.message}${RESET}`);
        }
      }
      if (count >= 11) console.groupEnd();
    }
    if (scope.assumptions) {
      const assumptions = [...scope.assumptions.entries()].map(
        ([k, v]) => `${k}: ${v}`
      );
      if (assumptions.length > 0) {
        console.groupCollapsed(`${assumptions.length} assumptions)`);
        for (const a of assumptions) console.info(a);
        console.groupEnd();
      }
    }
    if (scope.parentScope)
      this._printScope(options, scope.parentScope, depth + 1);

    console.groupEnd();

    return this.context;
  }

  /**
   * Declare an identifier: specify their domain, and other attributes,
   * including optionally a value.
   *
   * Once the domain of an identifier has been declared, it cannot be changed.
   * The domain information is used to calculate the canonical form of
   * expressions and ensure they are valid. If the domain could be changed
   * after the fact, previously valid expressions could become invalid.
   *
   * Use the `Anyting` domain for a very generic domain.
   *
   */
  declare(
    id: string,
    def: BoxedDomain | DomainExpression | SymbolDefinition | FunctionDefinition
  ): ComputeEngine;
  declare(identifiers: {
    [id: string]:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition;
  }): ComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]:
            | BoxedDomain
            | DomainExpression
            | SymbolDefinition
            | FunctionDefinition;
        },
    arg2?:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition
  ): ComputeEngine {
    //
    // If we got an object literal, call `declare` for each entry
    //
    if (typeof arg1 !== 'string' || arg2 === undefined) {
      for (const [id, def] of Object.entries(arg1)) this.declare(id, def);
      return this;
    }

    //
    // Declare a single symbol
    //

    // Function signatures are not valid with `ce.declare`, it must
    // be a plain identifier.
    const [id, args] = parseFunctionSignature(arg1);
    if (args !== undefined) {
      // ce.declare("f(x)", ["Add", "x", 1]) is not valid: the second argument
      // should be a domain or a definition. Use ce.assign() instead.
      throw Error(
        `Unexpected arguments with ${arg1}. Use 'ce.assign()' instead to assign a value, or a use a function definition with 'ce.declare()'.`
      );
    }

    // The special id `Nothing` can never be redeclared.
    // It is also used to indicate that a symbol should be ignored.
    if (id === 'Nothing') return this;

    if (this.context?.ids?.get(id)) {
      const def = this.context.ids.get(id);
      if (def instanceof _BoxedSymbolDefinition && def.inferredDomain) {
        // The domain of this symbol was inferred: it can be redeclared
        // with a different domain

        // Don't replace the def, since other expressions may already be
        // referencing it, but update it.
        if (isSymbolDefinition(arg2)) def.update(arg2);
        else {
          // @todo: could check that the new domain is compatible
          def.domain = this.domain(arg2 as DomainExpression);
          def.inferredDomain = false;
        }
        return this;
      }
      // Note: can't redeclare a symbol as other expressions might reference it
      // now and changing the definition might make them invalid (i.e. not
      // canonical)
      throw Error(
        `Symbol "${id}" has already been declared in the current scope`
      );
    }

    // Can't "undeclare" (set to undefined/null) a symbol either
    const def = arg2;
    if (!def) throw Error(`Expected a definition for ${id}`);

    //
    // Declaring a symbol or function with a definition
    //
    if (isSymbolDefinition(def)) {
      this.defineSymbol(id, def);
      return this;
    }

    if (isFunctionDefinition(def)) {
      this.defineFunction(id, def as FunctionDefinition);
      return this;
    }

    //
    // Declaring an identifier with a domain
    // `ce.declare("f", ["FunctionOf", "Numbers", "Numbers"])`
    // `ce.declare("z", "ComplexNumbers")`
    // `ce.declare("n", ce.Integers)`
    //
    {
      const dom = this.domain(def);
      if (dom.isValid) {
        if (dom.isFunction) {
          this.defineFunction(id, { signature: domainToSignature(dom) });
        } else {
          if (args) throw Error(`Unexpected arguments with domain for "${id}"`);
          this.defineSymbol(id, { domain: dom });
        }
      } else {
        throw Error(
          `Invalid argument for "${id}": use a domain, a FunctionDefinition or a SymbolDefinition`
        );
      }
    }

    return this;
  }

  /** Assign a value to an identifier in the current scope.
   * Use `undefined` to reset the identifier to no value.
   *
   * The identifier should be a valid MathJSON identifier
   * not a LaTeX string.
   *
   * The identifier can take the form "f(x, y") to create a function
   * with two parameters, "x" and "y".
   *
   * If the id was not previously declared, an automatic declaration
   * is done. The domain of the identifier is inferred from the value.
   * To more precisely define the domain of the identifier, use `ce.declare()`
   * instead, which allows you to specify the domain, value and other
   * attributes of the identifier.
   */
  assign(id: string, value: AssignValue): ComputeEngine;
  assign(ids: { [id: string]: AssignValue }): ComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): ComputeEngine {
    //
    // If we got an object literal, call `assign` for each entry
    //
    if (typeof arg1 === 'object') {
      console.assert(arg2 === undefined);
      for (const [id, def] of Object.entries(arg1)) this.assign(id, def);
      return this;
    }

    const [id, args] = parseFunctionSignature(arg1 as string);

    // Cannot set the value of 'Nothing'
    if (id === 'Nothing') return this;

    let value = arg2 as AssignValue;

    if (typeof value === 'boolean') value = value ? this.True : this.False;

    //
    // Is the value a LaTeX string (starts/ends with $ or $$)?
    // Parse it, as a non-canonical expression.
    // If we parse it as canonical, any unknowns will be auto-declared.
    //
    if (typeof value === 'string') {
      const latex = value.trim();
      if (latex.startsWith('$') && latex.endsWith('$')) {
        value = this.parse(latex.slice(1, -1), { canonical: false });
      } else if (latex.startsWith('$$') && latex.endsWith('$$')) {
        value = this.parse(latex.slice(2, -2), { canonical: false });
      } else {
        // Not a LaTeX string? interpret as a plain string (not a symbol)
        value = this.string(value);
      }
    }

    //
    // 1. The identifier was declared as a symbol in this scope
    //    or a parent scope
    //
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      if (symDef.constant)
        throw Error(`Cannot assign a value to the constant "${id}"`);

      if (!symDef.inferredDomain && isFunctionValue(value))
        throw Error(`Cannot assign a function to symbol "${id}"`);

      // Remove the def to avoid circular references.
      const scope = symDef.scope;
      scope?.ids?.delete(symDef.name!);

      // Make sure the value is not a function
      if (!args && !isFunctionValue(value)) {
        if (value === undefined || value === null) symDef.value = undefined;
        else symDef.value = this.box(value as BoxedExpression);

        // Reinsert the def in the scope
        scope?.ids?.set(symDef.name!, symDef);

        return this;
      }
    }

    //
    // 2. The identifier was declared as a function in this scope or
    //    a parent scope
    //
    const fnDef = this.lookupFunction(id);
    if (fnDef) {
      // Remove the def to avoid circular references.
      const scope = fnDef.scope;
      scope?.ids?.delete(fnDef.name!);

      if (value === undefined || value === null) return this;

      // Will replace definition if it already exists
      if (typeof value === 'function') {
        // Make sure defineFunction acts on the correct scope
        const previousScope = this.swapScope(scope!);
        this.defineFunction(id, { signature: { evaluate: value } });
        this.swapScope(previousScope);
        return this;
      }
      // If it's a function value, it should not have args,
      // since the args are part of the function value
      if (args && isFunctionValue(value))
        throw Error(`Unexpected arguments for "${id}"`);

      // Box value in the current scope
      const val = args
        ? this.box(['Function', value, ...args])
        : this.box(value);

      const previousScope = this.swapScope(scope!);
      this.defineFunction(id, { signature: { evaluate: val } });
      this.swapScope(previousScope);

      return this;
    }

    //
    // 3. The identifier has not been declared yet.
    //

    if (value === undefined || value === null) {
      // If we don't have a value, let type inference or explicit
      // declaration handle it.
      // We still want to reserve a spot for this value, so we declare it.
      this.declare(id, { inferred: true, domain: this.Anything });
      return this;
    }

    //
    // Is it a JS function?
    //
    if (typeof value === 'function') {
      this.defineFunction(id, { signature: { evaluate: value } });
      return this;
    }

    //
    // Is it a function expression?
    //
    if (
      value instanceof _BoxedExpression &&
      value.domain?.base === 'Functions'
    ) {
      this.defineFunction(id, { signature: { evaluate: value } });
      return this;
    }

    //
    // Is it an expression using anonymous parameters or unknowns,
    // or where there arguments declared?
    //
    if (Array.isArray(value) || value instanceof _BoxedExpression || args) {
      // This is a semi-boxed function expression i.e.
      // - a function: `["Add", "x", 1]` or `["Add", "_", 1]`
      // - or a value: ["Add", 1, 2]`

      // Get a non-canonical version: we don't want to have unknowns declared
      // as a side effect of canonicalization.
      let expr = this.box(value, { canonical: false });

      if (expr.head === 'Function') {
        // If no arguments are specified in the signature, add the 'args'
        expr = this.box([
          'Function',
          ...expr.ops!,
          ...(args ?? []).map((x) => this.symbol(x)),
        ]);
        this.defineFunction(id, {
          signature: { evaluate: expr },
        });
        return this;
      }

      const unknowns = [...expr.unknowns].sort();
      if (unknowns.length === 0) {
        // This is a value, not a function: define a symbol
        const value = expr.evaluate();
        this.defineSymbol(id, { value });
        return this;
      }

      // Probably an anonymous function. The unknowns are the parameters.

      // Check if unknowns includes "_" or "_n" where n is a digit
      if (unknowns.some((x) => /\_[\d]+/.test(x))) {
        // This is a function
        expr = this.box(['Function', expr]);
        this.defineFunction(id, {
          signature: { evaluate: expr },
        });
        return this;
      }

      // We had some unknowns, but they are not anonymous parameters
      if (args && args.length > 0) {
        this.pushScope();
        expr = this.box(['Function', expr, ...args]);
        this.popScope();
        this.defineFunction(id, {
          signature: { evaluate: expr },
        });
        return this;
      }

      // This is a value, not a function: define a symbol
      // e.g `ce.assign("f", ["Add", "x", 1]))` : no argument declared
      // use `ce.assign("f(x)", ["Add", "x", 1]))` instead
      // or `ce.assign("f", ["Function", ["Add", "x", 1], "x"])`
      this.pushScope();
      value = expr.evaluate();
      this.popScope();
    }

    // It's not a function, it's a symbol
    this.defineSymbol(id, { value });

    return this;
  }

  /**
   * Same as assign(), but for internal use:
   * - skips validity checks
   * - does not auto-declare
   * - if assigning to a function, must pass a JS function
   *
   * @internal
   */

  _assign(id: string, value: AssignValue): ComputeEngine {
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      console.assert(typeof value !== 'function');
      symDef.value = this.box(value as SemiBoxedExpression).evaluate();
      return this;
    }
    const fnDef = this.lookupFunction(id);
    if (fnDef) {
      console.assert(typeof value == 'function');
      const sig = fnDef.signature;
      fnDef.signature = {
        ...sig,
        N: undefined,
        simplify: undefined,
        canonical: undefined,
        evaluate: value as () => any,
      };
      return this;
    }

    console.assert(false, `Cannot assign to undeclared symbol "${id}"`);
    return this;
  }

  get assumptions(): ExpressionMapInterface<boolean> {
    if (!this.context) throw Error('No scope available');
    if (this.context.assumptions) return this.context.assumptions;
    // When creating a new context, the assumptions of this context
    // are a copy of all the previous assumptions
    // (as a result, there's no need to check parent assumptions,
    // and it solves the assumptions in a scope that could be contradictory
    // or complementary to previous assumptions).
    this.context.assumptions = new ExpressionMap<boolean>();
    return this.context.assumptions;
  }

  /**
   * Return false if the execution should stop.
   *
   * This can occur if:
   * - an error has been signaled
   * - the time limit or memory limit has been exceeded
   *
   * @internal
   */
  shouldContinueExecution(): boolean {
    return this.deadline === undefined || this.deadline >= Date.now();
  }

  /** @internal */
  checkContinueExecution(): void {
    if (!this.shouldContinueExecution()) {
      // @todo: should capture stack
      throw new Error('timeout');
    }
  }

  // assert(
  //   condition: boolean,
  //   expr: BoxedExpression,
  //   msg: string,
  //   code?: SignalMessage
  // ) {
  //   if (!condition) this.signal(expr, msg, code);
  // }

  /** @internal */
  cache<T>(cacheName: string, build: () => T, purge: (T) => T | undefined): T {
    if (this._cache[cacheName] === undefined) {
      try {
        this._cache[cacheName] = { build, purge, value: build() };
      } catch (e) {
        console.error(
          `Fatal error building cache "${cacheName}":\n\t ${e.toString()}`
        );
      }
    }

    return this._cache[cacheName]?.value;
  }

  /**
   * Return a boxed expression from the input.
   */
  box(
    expr:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression,
    options?: { canonical?: boolean | CanonicalForm | CanonicalForm[] }
  ): BoxedExpression {
    return box(this, expr, options);
  }

  canonical(xs: SemiBoxedExpression[]): BoxedExpression[] {
    if (!xs.every((x) => x instanceof _BoxedExpression))
      return xs.map((x) => this.box(x));

    const bxs = xs as BoxedExpression[];
    return bxs.every((x) => x.isCanonical) ? bxs : bxs.map((x) => x.canonical);
  }

  /**
   * Return a function expression.
   *
   * Note that the result may not be a function, or may have a different
   * `head` than the one specified.
   *
   * For example:
   * `ce.fn("Rational", [ce.number(1),  ce.number(2)]))` \( \to \) `ce.number([1,2])`
   *
   */
  fn(
    head: string,
    ops: BoxedExpression[],
    options?: { canonical: boolean }
  ): BoxedExpression {
    return boxFunction(this, head, ops, options ?? { canonical: true });
  }

  /** @internal */
  _fn(
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression {
    return new BoxedFunction(this, head, ops, {
      metadata,
      canonical: true,
    });
  }

  /**
   *
   * Shortcut for `this.fn("Error"...)`.
   *
   * The result is canonical.
   */
  error(
    message: string | [string, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression;
  error(
    message: string | [string, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression {
    if (where instanceof _BoxedExpression) {
      where = this.rawJson(where);
    } else if (where && Array.isArray(where) && where[0] === 'LatexString') {
      if (where[1] === undefined || !where[1]) where = '';
      if (typeof where[1] === 'object' && 'str' in where[1] && !where[1].str)
        where = '';
    }

    let msg: BoxedExpression | undefined = undefined;
    if (typeof message === 'string') msg = this.string(message);

    if (!msg && typeof message !== 'string')
      msg = new BoxedFunction(this, 'ErrorCode', [
        this.string(message[0]),
        ...message.slice(1).map((x) => {
          // console.assert(typeof x !== 'string' || isValidIdentifier(x));
          console.assert(typeof x !== 'string'); // For safety, require wrapped symbols or strings
          return this.box(x, { canonical: false });
        }),
      ]);

    if (!where)
      return new BoxedFunction(this, 'Error', [msg!], { canonical: false });

    return new BoxedFunction(
      this,
      'Error',
      [msg!, this.box(where, { canonical: false })],
      { canonical: false }
    );
  }

  domainError(
    expectedDomain: BoxedDomain | DomainLiteral,
    actualDomain: undefined | BoxedDomain,
    where?: SemiBoxedExpression
  ): BoxedExpression {
    const expected = isDomain(expectedDomain)
      ? this.domain(expectedDomain)
      : this.symbol(expectedDomain);

    const actual = actualDomain ? actualDomain : this.symbol('Undefined');

    return this.error(['incompatible-domain', expected, actual], where);
  }

  /**
   * Add a`["Hold"]` wrapper to `expr.
   */
  hold(expr: SemiBoxedExpression): BoxedExpression {
    return this._fn('Hold', [this.box(expr, { canonical: false })]);
  }

  /** Shortcut for `this.fn("Add"...)`.
   *
   * The result is canonical.
   */
  add(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalAdd(this, flattenOps(flattenSequence(ops), 'Add'));
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    return result;
  }

  /** Shortcut for `this.fn("Negate", [expr])`
   *
   * The result is canonical.
   */
  neg(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    return canonicalNegate(expr, metadata);
  }

  /** Shortcut for `this.fn("Multiply"...)`
   *
   * The result is canonical.
   */
  mul(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalMultiply(
      this,
      flattenOps(flattenSequence(ops), ' Multiply')
    );
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    return result;
  }

  /** Shortcut for `this.fn("Divide", [num, denom])`
   *
   * The result is canonical.
   */
  div(
    num: BoxedExpression,
    denom: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalDivide(this, num, denom);
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    return result;
  }

  /** Shortcut for `this.fn("Sqrt"...)`
   *
   * The result is canonical.
   */
  sqrt(base: BoxedExpression, metadata?: Metadata) {
    return canonicalPower(this, base, this.Half, metadata);
  }

  /** Shortcut for `this.fn("Power"...)`
   *
   * The result is canonical.
   */
  pow(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path. Note that arguments are **not** validated.

    // Handle complex numbers (exp^{ci}}) as a special case
    if (base.symbol === 'ExponentialE' && exponent instanceof Complex) {
      const im = exponent.im;
      const re = exponent.re;
      if (re === 0)
        return this.number(this.complex(Math.cos(im), Math.sin(im)));
      if (im === 0) return this.number(Math.exp(re));
      const e = Math.exp(re);
      return this.number(this.complex(e * Math.cos(im), e * Math.sin(im)));
    }

    // The logic here handles the cases where the exponent is a number or Rational
    if (exponent instanceof _BoxedExpression) {
      const num = exponent.numericValue;
      if (num !== null) {
        if (typeof num === 'number') exponent = num;
        if (isRational(num)) exponent = num;
      }
    }

    let e: number | null = null;

    if (typeof exponent === 'number') e = exponent;
    else if (isRational(exponent)) {
      if (isRationalZero(exponent)) return this.One;
      if (isRationalOne(exponent)) return base;
      // Is the denominator 1?
      if (isMachineRational(exponent) && exponent[1] === 1) e = exponent[0];
      else if (isBigRational(exponent) && exponent[1] === BigInt(1))
        e = Number(exponent[0]);
    }

    // x^0
    if (e === 0) return this.One;

    // x^1
    if (e === 1) return base;

    // x^(-1)
    const r = base.numericValue;
    if (e === -1 && r !== null) {
      if (typeof r === 'number' && Number.isInteger(r))
        return this.number([1, r]);
      else if (r instanceof Decimal && r.isInteger())
        return this.number([BigInt(1), bigint(r)]);
      else if (isRational(r)) return this.number([r[1], r[0]] as Rational);
    }

    if (typeof exponent === 'number' || isRational(exponent))
      exponent = this.number(exponent);

    return canonicalPower(this, base, exponent, metadata);
  }

  /** Shortcut for `this.fn("Divide", [1, expr])`
   *
   * The result is canonical.
   */
  inv(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    if (expr.isOne) return this.One;
    if (expr.isNegativeOne) return this.NegativeOne;
    if (expr.isInfinity) return this.Zero;
    const n = expr.numericValue;
    if (n !== null) {
      if (isRational(n)) return this.number(inverse(n), { metadata });
      if (typeof n === 'number' && Number.isInteger(n))
        return this.number([1, n], { metadata });

      if (n instanceof Decimal && n.isInteger())
        return this.number([BigInt(1), bigint(n)], { metadata });
      return this._fn('Divide', [this.One, expr], metadata);
    }

    if (expr.head === 'Sqrt')
      return this._fn('Sqrt', [this.inv(expr.op1)], metadata);

    if (expr.head === 'Divide')
      return this._fn('Divide', [expr.op1, expr.op2], metadata);

    // Inverse(expr) -> expr^{-1}
    let e = this.NegativeOne;

    if (expr.head === 'Power') {
      // Inverse(x^{-1}) -> x
      if (expr.op2.isNegativeOne) return expr.op1;

      // Inverse(x^n) -> x^{-n}
      e = canonicalNegate(expr.op2);
      expr = expr.op1;
    }
    if (e.isNegativeOne) return this._fn('Divide', [this.One, expr], metadata);
    return this._fn('Power', [expr, e], metadata);
  }

  /** Shortcut for `this.fn("Pair"...)`
   *
   * The result is canonical.
   */
  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path
    return new BoxedFunction(this, 'Tuple', [first, second], {
      metadata,
      canonical: true,
    });
  }

  /** Shortcut for `this.fn("Tuple"...)`
   *
   * The result is canonical.
   */
  tuple(elements: number[], metadata?: Metadata): BoxedExpression;
  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression;
  tuple(
    elements: (number | BoxedExpression)[],
    metadata?: Metadata
  ): BoxedExpression {
    // Short path
    if (typeof elements[0] === 'number') {
      return new BoxedFunction(
        this,
        'Tuple',
        (elements as number[]).map((x) => this.number(x)),
        {
          metadata,
          canonical: true,
        }
      );
    }
    return new BoxedFunction(
      this,
      'Tuple',
      canonical(elements as BoxedExpression[]),
      {
        metadata,
        canonical: true,
      }
    );
  }

  array(
    elements: ArrayValue[] | ArrayValue[][],
    metadata?: Metadata
  ): BoxedExpression {
    // @todo
    // return new BoxedFunction(this, 'List', canonical(elements), {
    //   metadata,
    //   canonical: true,
    // });
    return this.Nothing;
  }

  string(s: string, metadata?: Metadata): BoxedExpression {
    return new BoxedString(this, s, metadata);
  }

  /** Return a boxed symbol */
  symbol(
    name: string,
    options?: { metadata?: Metadata; canonical?: boolean }
  ): BoxedExpression {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;

    // Identifiers such as symbol names should use the Unicode NFC canonical form
    name = name.normalize();

    // These three are not symbols (some of them are not even valid
    // identifiers) but they're a common type
    if (name === 'NaN') return this.NaN;
    if (name === 'Infinity') return this.PositiveInfinity;
    if (name === '+Infinity') return this.PositiveInfinity;
    if (name === '-Infinity') return this.NegativeInfinity;

    // `Half` is a synonym for the rational 1/2
    if (name === 'Half') return this.Half;

    if (this.strict && !isValidIdentifier(name)) {
      const where = options?.metadata?.latex;
      const nameStr = `'${name}'`;
      return this.error(
        ['invalid-identifier', { str: validateIdentifier(name) }],
        where ? ['LatexString', `'${where}'`] : nameStr
      );
    }

    // If there is some LaTeX metadata provided, we can't use the
    // `_commonSymbols` cache, as their LaTeX metadata may not match.
    if (options?.metadata?.latex !== undefined && !options.canonical)
      return new BoxedSymbol(this, name, options);

    const result = this._commonSymbols[name];
    if (result) {
      // Only use the cache if there is no metadata or it matches
      if (
        !options?.metadata?.wikidata ||
        !result.wikidata ||
        result.wikidata === options.metadata.wikidata
      )
        return result;
      if (options.canonical) return makeCanonicalSymbol(this, name);
      return new BoxedSymbol(this, name, options);
    }
    if (options.canonical) return makeCanonicalSymbol(this, name);
    return new BoxedSymbol(this, name, options);
  }

  /** Return a canonical boxed domain.
   *
   * If the domain is invalid, may return an `["Error"]` expression
   *
   */
  domain(
    domain: BoxedDomain | DomainExpression,
    metadata?: Metadata
  ): BoxedDomain {
    if (domain instanceof _BoxedDomain) return domain;

    if (typeof domain === 'string') {
      const expr = this._commonDomains[domain];
      if (expr) return expr;
    }

    // @fastpath: skip validity checks when not in stric mode
    if (!this.strict) {
      if (typeof domain === 'string') {
        const expr = DOMAIN_ALIAS[domain];
        if (expr) return this.domain(expr);
      }
      return new _BoxedDomain(this, domain as DomainExpression, metadata);
    }

    // Wrapped in a `Domain` expression
    if (Array.isArray(domain) && (domain[0] as string) === 'Domain')
      domain = domain[1] as DomainExpression;

    if (typeof domain === 'string') {
      const expr = DOMAIN_ALIAS[domain];
      if (expr) return this.domain(expr);
      if (!isDomainLiteral(domain))
        throw Error('Expected a domain literal, got ' + domain);
      return new _BoxedDomain(this, domain, metadata);
    }

    if (!Array.isArray(domain) || domain.length === 0)
      throw Error('Expected a valid domain');

    const constructor = domain[0];

    if (!DOMAIN_CONSTRUCTORS.includes(constructor))
      throw Error('Expected a domain constructor, got ' + constructor);
    return new _BoxedDomain(this, domain, metadata);
  }

  /**
   * This function tries to avoid creating a boxed number if `num` corresponds
   * to a common value for which we have a shared instance (-1, 0, NaN, etc...)
   */
  number(
    value:
      | number
      | bigint
      | string
      | MathJsonNumber
      | Decimal
      | Complex
      | Rational,
    options?: { canonical?: boolean; metadata?: Metadata }
  ): BoxedExpression {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;

    //
    // Is this number eligible to be a cached number expression?
    //
    if (options.metadata === undefined) {
      if (typeof value === 'bigint') {
        if (value === BigInt(1)) return this.One;
        if (value === BigInt(0)) return this.Zero;
        if (value === BigInt(-1)) return this.NegativeOne;
      }
      if (typeof value === 'number') {
        const n = value;
        if (n === 1) return this.One;
        if (n === 0) return this.Zero;
        if (n === -1) return this.NegativeOne;

        if (Number.isInteger(n) && this._commonNumbers[n] !== undefined) {
          if (this._commonNumbers[n] === null)
            this._commonNumbers[n] = boxNumber(this, value) ?? this.NaN;
          return this._commonNumbers[n]!;
        }

        if (Number.isNaN(n)) return this.NaN;

        if (!Number.isFinite(n))
          return n < 0 ? this.NegativeInfinity : this.PositiveInfinity;
      }
    }

    if (typeof value === 'bigint') value = this.bignum(value);

    return boxNumber(this, value, options) ?? this.NaN;
  }

  rules(rules: Rule[]): BoxedRuleSet {
    return boxRules(this, rules);
  }

  pattern(expr: LatexString | SemiBoxedExpression): Pattern {
    return new BoxedPattern(this, expr);
  }

  /**
   * Parse a string of LaTeX and return a corresponding `BoxedExpression`.
   *
   * The result may not be canonical.
   *
   */
  parse(
    latex: LatexString | string,
    options?: { canonical?: boolean | CanonicalForm | CanonicalForm[] }
  ): BoxedExpression;
  parse(
    s: null,
    options?: { canonical?: boolean | CanonicalForm | CanonicalForm[] }
  ): null;
  parse(
    latex: LatexString | string | null,
    options?: { canonical?: boolean | CanonicalForm | CanonicalForm[] }
  ): null | BoxedExpression;
  parse(
    latex: LatexString | null | string,
    options?: { canonical?: boolean | CanonicalForm | CanonicalForm[] }
  ): BoxedExpression | null {
    if (typeof latex !== 'string') return null;
    const result = this.latexSyntax.parse(latexString(latex) ?? latex);
    return this.box(result, options);
  }

  /** Serialize a `BoxedExpression` or a `MathJSON` expression to
   * a LaTeX string
   */
  serialize(
    x: Expression | BoxedExpression,
    options?: { canonical?: boolean }
  ): string {
    if (typeof x === 'object' && 'json' in x) {
      const ce = 'engine' in x ? x.engine : this;
      return this.latexSyntax.serialize(
        this.rawJson(ce.box(x, { canonical: false })),
        options
      );
    }
    return this.latexSyntax.serialize(x as Expression, options);
  }

  /**
   * Options to control the serialization of MathJSON expression to LaTeX
   * when using `this.latex` or `this.engine.serialize()`.
   *
   *
   * {@inheritDoc  NumberFormattingOptions}
   * {@inheritDoc  ParseLatexOptions}
   * {@inheritDoc  SerializeLatexOptions}
   *
   */
  get latexOptions(): NumberFormattingOptions &
    ParseLatexOptions &
    SerializeLatexOptions {
    const latexSyntax = this.latexSyntax;
    return new Proxy(
      {
        ...this.latexSyntax.options,
        ...this.latexSyntax.serializer.options,
      },
      {
        set(options, prop, value): boolean {
          if (!(prop in options)) return false;
          latexSyntax.updateOptions({ [prop]: value });
          return true;
        },
      }
    );
  }

  set latexOptions(
    opts: Partial<NumberFormattingOptions> &
      Partial<ParseLatexOptions> &
      Partial<SerializeLatexOptions>
  ) {
    this.latexSyntax.updateOptions(opts);
  }

  /** {@inheritDoc  JsonSerializationOptions} */
  get jsonSerializationOptions(): Readonly<JsonSerializationOptions> {
    if (this._useRawJsonSerializationOptions) {
      return new Proxy(this._rawJsonSerializationOptions, {
        get(options, prop) {
          if (!(prop in options)) return undefined;
          return options[prop];
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return new Proxy(this._jsonSerializationOptions, {
      get(options, prop) {
        if (!(prop in options)) return undefined;
        return options[prop];
      },
      set(options, prop, value): boolean {
        if (!(prop in options)) return false;
        self.jsonSerializationOptions = { [prop]: value };
        return true;
      },
    });
  }

  set jsonSerializationOptions(val: Partial<JsonSerializationOptions>) {
    if (val.exclude) this._jsonSerializationOptions.exclude = [...val.exclude];
    if (val.shorthands) {
      if (
        (val.shorthands as unknown as string) === 'all' ||
        val.shorthands.includes('all')
      ) {
        this._jsonSerializationOptions.shorthands = [
          'function',
          'symbol',
          'string',
          'dictionary',
          'number',
        ];
      } else this._jsonSerializationOptions.shorthands = [...val.shorthands];
    }
    if (val.metadata) {
      if (
        (val.metadata as unknown as string) === 'all' ||
        val.metadata.includes('all')
      ) {
        this._jsonSerializationOptions.metadata = ['latex', 'wikidata'];
      } else this._jsonSerializationOptions.metadata = [...val.metadata];
    }
    if (typeof val.precision === 'number' && val.precision > 0) {
      this._jsonSerializationOptions.precision = val.precision;
    }
    if (typeof val.repeatingDecimals === 'boolean') {
      this._jsonSerializationOptions.repeatingDecimals = val.repeatingDecimals;
    }
  }

  rawJson(expr: BoxedExpression): Expression {
    const save = this._useRawJsonSerializationOptions;
    this._useRawJsonSerializationOptions = true;
    const result = expr.json;
    this._useRawJsonSerializationOptions = save;
    return result;
  }

  /**
   * Return a list of all the assumptions that match a pattern.
   *
   * ```js
   *  ce.assume(['Element', 'x', 'PositiveIntegers');
   *  ce.ask(['Greater', 'x', '_val'])
   *  //  -> [{'val': 0}]
   * ```
   */
  ask(pattern: SemiBoxedExpression): BoxedSubstitution[] {
    const pat = this.pattern(pattern);
    const result: BoxedSubstitution[] = [];
    for (const [assumption, val] of this.assumptions) {
      const m = pat.match(assumption, {
        numericTolerance: this._tolerance,
      });
      if (m !== null && val === true) result.push(m);
    }
    return result;
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(_query: SemiBoxedExpression): boolean {
    // @todo
    return false;
  }

  /**
   * Add an assumption.
   *
   * Note that the assumption is put into canonical form before being added.
   *
   * @param symbol - The symbol to make an assumption about
   *
   * Returns:
   * - `contradiction` if the new assumption is incompatible with previous
   * ones.
   * - `tautology` if the new assumption is redundant with previous ones.
   * - `ok` if the assumption was successfully added to the assumption set.
   *
   *
   */
  assume(predicate: SemiBoxedExpression): AssumeResult {
    try {
      return assume(this.box(predicate, { canonical: false }));
    } catch (e) {
      console.error(e.toString());
      return 'internal-error';
    }
  }

  /** Remove all assumptions about one or more symbols */
  forget(symbol: undefined | string | string[]): void {
    if (!this.context) throw Error('No scope available');

    //
    // ## THEORY OF OPERATIONS
    //
    // When forgeting we need to preserve existing definitions for symbols,
    // as some expressions may be pointing to them. Instead, we
    // reset the value of those definitions, but don't change the domain.
    //

    if (symbol === undefined) {
      if (this.context.ids)
        for (const k of this.context.ids.keys()) this.forget(k);

      this.assumptions.clear();
      return;
    }

    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }

    if (typeof symbol === 'string') {
      // Remove symbol definition in the current scope (if any)
      if (this.context.ids) {
        const def = this.context.ids.get(symbol);
        if (def instanceof _BoxedSymbolDefinition) def.value = undefined;
        else if (def instanceof _BoxedFunctionDefinition) {
          const sig = def.signature;
          def.signature = {
            ...sig,
            evaluate: undefined,
            N: undefined,
            simplify: undefined,
            canonical: undefined,
          };
        }
      }
      // Remove any assumptions that make a reference to this symbol
      // (note that when a scope is created, any assumptions from the
      // parent scope are copied over, so this effectively removes any
      // reference to this symbol, even if there are assumptions about
      // it in a parent scope. However, when the current scope exits,
      // any previous assumptions about the symbol will be restored).
      for (const [assumption, _val] of this.assumptions) {
        if (assumption.symbols.includes(symbol))
          this.assumptions.delete(assumption);
      }
    }
  }
}

/** Return true if the value is a function  */
function isFunctionValue(value: AssignValue): boolean {
  if (typeof value === 'function') return true;
  if (value instanceof _BoxedExpression && value.domain?.base === 'Functions')
    return true;

  return false;
}
