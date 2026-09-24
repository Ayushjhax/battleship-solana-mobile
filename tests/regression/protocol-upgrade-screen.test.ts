import { describe, expect, it } from 'vitest';

import { searchFailurePresentation } from '../../src/features/matchmaking/failurePresentation';

describe('old-client protocol gate presentation', () => {
  it('shows a terminal update screen and never offers a futile retry', () => {
    const presentation = searchFailurePresentation('upgrade_required');

    expect(presentation).toEqual({
      title: 'Update required',
      primaryAction: null,
      primaryLabel: null,
    });
  });
});
