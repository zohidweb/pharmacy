import { HttpException } from '@nestjs/common';
import { ProblemException } from './problem.exception';

describe('ProblemException', () => {
  it('is an HttpException with the status, the code and an optional detail', () => {
    const error = new ProblemException(403, 'forbidden', 'No access');

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('forbidden');
    expect(error.detail).toBe('No access');
    expect(error.getResponse()).toEqual({
      status: 403,
      code: 'forbidden',
      detail: 'No access',
    });
  });

  it('has no detail when none is given', () => {
    const error = new ProblemException(401, 'unauthenticated');

    expect(error.detail).toBeUndefined();
    expect(error.getResponse()).toEqual({
      status: 401,
      code: 'unauthenticated',
    });
    expect(error.message).toBe('unauthenticated');
  });
});
