import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  SimplifyOptions,
  Metadata,
  BoxedDomain,
  BoxedSubstitution,
  PatternMatchOptions,
  BoxedBaseDefinition,
  BoxedFunctionDefinition,
} from '../public';
import {
  DataTypeMap,
  TensorDataType,
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from '../symbolic/tensor-fields';
import { AbstractTensor, TensorData, makeTensor } from '../symbolic/tensors';
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';

/**
 * A boxed tensor represents an expression that can be
 * represented by a tensor. This could be a vector, matrix
 * or multi-dimensional array.
 *
 * The object can be created either from a tensor or from
 * an expression that can be represented as a tensor.
 *
 * The counterpart (expression if input is tensor, or tensor
 * if input is expression) is created lazily.
 *
 */
export class BoxedTensor extends _BoxedExpression {
  private readonly _head?: string;
  private readonly _ops?: BoxedExpression[];

  private _tensor: undefined | AbstractTensor<'expression'>;

  private _expression: undefined | BoxedExpression;

  constructor(
    ce: IComputeEngine,
    input:
      | {
          head?: string;
          ops: BoxedExpression[];
        }
      | AbstractTensor<'expression'>,
    options?: { canonical?: boolean; metadata?: Metadata }
  ) {
    options ??= {};
    options.canonical ??= true;
    super(ce, options.metadata);

    if (input instanceof AbstractTensor) {
      this._tensor = input;
    } else {
      this._head = input.head ?? 'List';
      this._ops = options.canonical ? ce.canonical(input.ops) : input.ops;

      this._expression = ce._fn(this._head, this._ops);
      this.expression.isCanonical = options.canonical;
    }

    ce._register(this);
  }

  get expression(): BoxedExpression {
    // Make an expression from the tensor
    this._expression ??= this._tensor!.expression;

    return this._expression;
  }

  /** Create the tensor on demand */
  get tensor(): AbstractTensor<'expression'> {
    if (this._tensor === undefined) {
      console.assert(this._head !== undefined);
      console.assert(this._ops !== undefined);
      const tensorData = expressionAsTensor<'expression'>(
        this._head!,
        this._ops!
      );
      if (tensorData === undefined) throw new Error('Invalid tensor');
      this._tensor = makeTensor(this.engine, tensorData);
    }
    return this._tensor!;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.expression.baseDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this.expression.functionDefinition;
  }

  bind(): void {
    this.expression.bind();
  }

  reset(): void {}

  get hash(): number {
    let h = hashCode('BoxedTensor');
    // for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get canonical(): BoxedExpression {
    return this.expression.canonical;
  }

  get isCanonical(): boolean {
    if (this._tensor) return true;
    return this.expression.isCanonical;
  }

  set isCanonical(val: boolean) {
    if (!this._tensor) this.expression.isCanonical = val;
  }

  get isPure(): boolean {
    if (this._tensor) return true;
    return this.expression.isPure;
  }

  get isValid(): boolean {
    if (this._tensor) return true;
    return this.expression.isValid;
  }

  get complexity(): number {
    return 97;
  }

  get head(): string {
    return this._tensor ? 'List' : this._head!;
  }

  get nops(): number {
    if (this._tensor) return this._tensor.shape[0];
    return this.expression.nops;
  }

  get ops(): BoxedExpression[] {
    return this.expression.ops!;
  }

  get op1(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length === 0) return this.engine.Nothing;
      return this.engine.box(data[0]);
    }
    return this.expression.op1;
  }

  get op2(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 2) return this.engine.Nothing;
      return this.engine.box(data[1]);
    }
    return this.expression.op2;
  }

  get op3(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 3) return this.engine.Nothing;
      return this.engine.box(data[2]);
    }
    return this.expression.op3;
  }

  get shape(): number[] {
    return this.tensor.shape;
  }

  get rank(): number {
    return this.tensor.rank;
  }

  get domain(): BoxedDomain | undefined {
    if (this._tensor) return this.engine.domain('Lists');
    return this.expression.domain;
  }

  get json(): Expression {
    // @todo tensor: could be optimized by avoiding creating
    // an expression and getting the JSON from the tensor directly
    return this.expression.json;
  }

  get rawJson(): Expression {
    // @todo tensor: could be optimized by avoiding creating
    // an expression and getting the JSON from the tensor directly
    return this.expression.rawJson;
  }

  /** Structural equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (rhs instanceof BoxedTensor) return this.tensor.equals(rhs.tensor);

    return this.expression.isSame(rhs);
  }

  /** Mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (rhs instanceof BoxedTensor) return this.tensor.equals(rhs.tensor);

    return this.expression.isEqual(rhs);
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return this.expression.match(rhs, options);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.evaluate(options);
  }

  simplify(options?: SimplifyOptions): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.simplify(options);
  }

  N(options?: NOptions): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.N(options);
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}

export function expressionTensorInfo(head: string, rows: BoxedExpression[]) {
  let dtype: TensorDataType | undefined = undefined;
  let shape: number[] = [];
  let valid = true;

  const visit = (t: BoxedExpression[], axis = 0) => {
    if (t.length === 0) return;
    if (t.length > 1 && shape[axis] !== undefined)
      valid = valid && shape[axis] === t.length;
    else shape[axis] = Math.max(shape[axis] ?? 0, t.length);

    for (const item of t) {
      if (item.head === head) visit(item.ops!, axis + 1);
      else {
        if (dtype === undefined) dtype = getExpressionDatatype(item);
        else dtype = getSupertype(dtype, getExpressionDatatype(item));
      }
      if (!valid) return;
    }
  };

  visit(rows);

  if (!valid) return undefined;
  return { shape, dtype };
}

export function expressionAsTensor<T extends TensorDataType>(
  head: string,
  rows: BoxedExpression[]
): TensorData<T> | undefined {
  let { shape, dtype } = expressionTensorInfo(head, rows) ?? {
    shape: [],
    dtype: undefined,
  };
  if (dtype === undefined) return undefined;

  let isValid = true;
  const data: DataTypeMap[T][] = [];
  const f = makeTensorField(rows[0].engine, 'expression');
  const cast = f.cast.bind(f);
  const visit = (t: BoxedExpression[]) => {
    for (const item of t) {
      if (item.head === head) visit(item.ops!);
      else {
        const v = cast(item, dtype);
        if (v === undefined) {
          isValid = false;
          return;
        }
        data.push(v);
      }
    }
  };
  visit(rows);
  if (!isValid) return undefined;
  return { shape, data, dtype: dtype as T };
}
