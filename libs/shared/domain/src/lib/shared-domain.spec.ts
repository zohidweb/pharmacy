import { sharedDomain } from './shared-domain.js';

describe('sharedDomain', () => {
  it('should work', () => {
    expect(sharedDomain()).toEqual('shared-domain');
  });
});
