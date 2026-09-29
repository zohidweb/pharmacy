import { sharedDto } from './shared-dto.js';

describe('sharedDto', () => {
  it('should work', () => {
    expect(sharedDto()).toEqual('shared-dto');
  });
});
