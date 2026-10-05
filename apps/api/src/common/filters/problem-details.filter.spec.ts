import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { UnauthenticatedError } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';
import { ProblemDetailsFilter } from './problem-details.filter';

// The filter is exercised with plain request/response doubles: it only reads the correlation id and
// writes status, content type and body.

class LoginBody {
  @IsString()
  @MaxLength(5)
  login!: string;
}

interface Captured {
  status: number | undefined;
  headers: Record<string, string>;
  payload: string | undefined;
}

function run(
  error: unknown,
  req: { correlationId?: string } = { correlationId: 'corr-1234-abcd' },
  headersSent = false,
): Captured & { body: Record<string, unknown> } {
  const captured: Captured = {
    status: undefined,
    headers: {},
    payload: undefined,
  };
  const res = {
    headersSent,
    status(code: number) {
      captured.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    send(payload: string) {
      captured.payload = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;

  new ProblemDetailsFilter().catch(error, host);

  return {
    ...captured,
    body: captured.payload ? JSON.parse(captured.payload) : {},
  };
}

async function validationError(input: unknown): Promise<unknown> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  try {
    await pipe.transform(input, { type: 'body', metatype: LoginBody });
  } catch (error) {
    return error;
  }
  throw new Error('the pipe accepted the input');
}

describe('ProblemDetailsFilter', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders a ProblemException with its status and code as application/problem+json', () => {
    const out = run(new ProblemException(403, 'csrf_rejected'));

    expect(out.status).toBe(403);
    expect(out.headers['content-type']).toBe('application/problem+json');
    expect(out.body).toMatchObject({
      type: 'about:blank',
      status: 403,
      code: 'csrf_rejected',
      correlationId: 'corr-1234-abcd',
    });
    expect(typeof out.body['title']).toBe('string');
  });

  it('carries the fixed detail of a ProblemException', () => {
    const out = run(
      new ProblemException(422, 'password_policy', 'The password is too short'),
    );

    expect(out.status).toBe(422);
    expect(out.body['detail']).toBe('The password is too short');
  });

  it('turns a ValidationPipe 400 into validation_failed without echoing any input', async () => {
    const error = await validationError({
      login: 'TOO-LONG-VALUE-SECRET',
      injectedField: 'ECHOED-VALUE',
    });

    const out = run(error);

    expect(out.status).toBe(400);
    expect(out.body['code']).toBe('validation_failed');
    expect(out.body['correlationId']).toBe('corr-1234-abcd');
    const text = out.payload ?? '';
    expect(text).not.toContain('TOO-LONG-VALUE-SECRET');
    expect(text).not.toContain('ECHOED-VALUE');
    expect(text).not.toContain('injectedField');
  });

  it('does not use the message of other Nest HttpExceptions (it may echo the path or the body)', () => {
    const out = run(new NotFoundException('Cannot GET /api/v1/secret-path'));

    expect(out.status).toBe(404);
    expect(out.body['code']).toBe('not_found');
    expect(out.payload).not.toContain('secret-path');
  });

  it('maps a plain HttpException by status', () => {
    const out = run(new ForbiddenException('whatever'));

    expect(out.status).toBe(403);
    expect(out.body['code']).toBe('forbidden');
  });

  it('maps a malformed JSON body (BadRequestException with a parser message) to a generic 400', () => {
    const out = run(
      new BadRequestException('Unexpected token x in "my-password"'),
    );

    expect(out.status).toBe(400);
    expect(out.payload).not.toContain('my-password');
  });

  it('maps a body-parser style 4xx error by its status', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    const out = run(error);

    expect(out.status).toBe(413);
    expect(out.body['code']).toBe('payload_too_large');
  });

  it('maps UnauthenticatedError to 401 unauthenticated', () => {
    const out = run(new UnauthenticatedError());

    expect(out.status).toBe(401);
    expect(out.body['code']).toBe('unauthenticated');
  });

  it('answers an unknown error with a generic 500, the correlation id and no stack or message', () => {
    const out = run(new Error('connection to db://user:hunter2@host failed'), {
      correlationId: 'corr-9999-zzzz',
    });

    expect(out.status).toBe(500);
    expect(out.headers['content-type']).toBe('application/problem+json');
    expect(out.body).toMatchObject({
      status: 500,
      code: 'internal_error',
      correlationId: 'corr-9999-zzzz',
    });
    expect(out.payload).not.toContain('hunter2');
    expect(out.payload).not.toContain(' at ');
    expect(out.payload).not.toContain('stack');
  });

  it('logs an unknown error with its correlation id but not its message', () => {
    run(new Error('connection to db://user:hunter2@host failed'), {
      correlationId: 'corr-9999-zzzz',
    });

    expect(logged.join('\n')).toContain('corr-9999-zzzz');
    expect(logged.join('\n')).not.toContain('hunter2');
  });

  it('does not throw for a non-Error value and still answers 500', () => {
    const out = run('boom');

    expect(out.status).toBe(500);
    expect(out.body['code']).toBe('internal_error');
  });

  it('issues a correlation id when the request has none', () => {
    const out = run(new ProblemException(401, 'unauthenticated'), {});

    expect(typeof out.body['correlationId']).toBe('string');
    expect((out.body['correlationId'] as string).length).toBeGreaterThan(0);
  });

  it('does not write a second answer once the headers have been sent', () => {
    const out = run(
      new Error('late'),
      { correlationId: 'corr-1234-abcd' },
      true,
    );

    expect(out.payload).toBeUndefined();
  });
});
