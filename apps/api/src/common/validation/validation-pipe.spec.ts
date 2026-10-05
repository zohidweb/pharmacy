import { type ArgumentsHost } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProblemDetailsFilter } from '../filters/problem-details.filter';
import { createValidationPipe } from './validation-pipe';

// The global ValidationPipe turns class-validator failures into 400 validation_failed with
// errors[]: { field, code } (ADR-0015, axis 4). Fields are DTO property paths, codes are
// snake_case constraint names; values, messages and client-chosen names are never sent.

class Line {
  @IsInt()
  @Min(1)
  @Max(10)
  qty!: number;
}

class Body {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  login!: string;

  @ValidateNested({ each: true })
  @Type(() => Line)
  items!: Line[];
}

async function fail(input: unknown) {
  const pipe = createValidationPipe();
  let error: unknown;
  try {
    await pipe.transform(input, { type: 'body', metatype: Body });
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error('the pipe accepted the input');
  const sent: { status?: number; payload?: string } = {};
  const res = {
    headersSent: false,
    status(code: number) {
      sent.status = code;
      return res;
    },
    setHeader() {
      return res;
    },
    send(payload: string) {
      sent.payload = payload;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ correlationId: 'corr-1234-abcd' }),
    }),
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(error, host);
  return {
    status: sent.status,
    text: sent.payload ?? '',
    body: JSON.parse(sent.payload ?? '{}') as {
      code: string;
      errors: { field?: string; code: string }[];
    },
  };
}

describe('createValidationPipe', () => {
  it('lists the failing fields with snake_case codes and nothing else', async () => {
    const { status, body } = await fail({
      login: 'TOO-LONG-SECRET',
      items: [{ qty: 1 }],
    });

    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.errors).toEqual([{ field: 'login', code: 'max_length' }]);
  });

  it('uses the nested path for objects and array elements', async () => {
    const { body } = await fail({
      login: 'ok',
      items: [{ qty: 1 }, { qty: 99 }],
    });

    expect(body.errors).toEqual([{ field: 'items.1.qty', code: 'max' }]);
  });

  it('reports one entry per field, with the first failed constraint as the code', async () => {
    // A number breaks both @IsString and @MaxLength: still one entry for the field.
    const { body } = await fail({ login: 12345678, items: [] });

    const login = body.errors.filter((e) => e.field === 'login');
    expect(login).toHaveLength(1);
    expect(['is_string', 'max_length']).toContain(login[0].code);
  });

  it('reports a missing field', async () => {
    const { body } = await fail({ items: [] });

    expect(body.errors.map((e) => e.field)).toContain('login');
  });

  it('never sends values, messages or class-validator internals', async () => {
    const { text } = await fail({ login: 'TOO-LONG-SECRET', items: [] });

    expect(text).not.toContain('TOO-LONG-SECRET');
    expect(text).not.toContain('must be');
    expect(text).not.toContain('constraints');
    expect(text).not.toContain('target');
    expect(text).not.toContain('"value"');
  });

  it('collapses unknown properties into one entry without the client name', async () => {
    const { body, text } = await fail({
      login: 'ok',
      items: [],
      secretFieldA: 'ECHO-A',
      secretFieldB: 'ECHO-B',
    });

    expect(body.errors).toEqual([{ field: '', code: 'unknown_property' }]);
    expect(text).not.toContain('secretField');
    expect(text).not.toContain('ECHO-');
  });

  it('keeps real field errors next to the unknown-property entry', async () => {
    const { body } = await fail({ login: '', items: [], extra: 1 });

    const codes = body.errors.map((e) => e.code);
    expect(codes).toContain('unknown_property');
    expect(body.errors.some((e) => e.field === 'login')).toBe(true);
  });
});
