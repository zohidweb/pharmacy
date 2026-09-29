import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();

    expect(moduleRef.get(HealthController).check()).toEqual({ status: 'ok' });
  });
});
