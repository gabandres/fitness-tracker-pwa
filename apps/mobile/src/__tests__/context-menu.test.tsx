import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';

/**
 * `ContextMenu` rides on expo-router's native context-menu views through a
 * deep import. These lock the two things that can break without a device:
 * the import still resolves (a moved file fails HERE, not on a phone), and
 * where the native views are unavailable the child still renders — expo-router
 * returns null for them there, which would otherwise take the row with it.
 */
describe('ContextMenu (S20)', () => {
  it('the native views it depends on still exist at the deep-import path', () => {
    const native = require('expo-router/build/link/preview/native');
    expect(typeof native.NativeLinkPreview).toBe('function');
    expect(typeof native.NativeLinkPreviewAction).toBe('function');
    expect(typeof native.NativeLinkPreviewContent).toBe('function');
  });

  it('is off without the bridgeless runtime (jest), and renders the child alone', async () => {
    expect(CONTEXT_MENUS).toBe(false);
    const view = await render(
      <ContextMenu title="Oatmeal" actions={[{ key: 'edit', title: 'Edit', onPress: () => {} }]}>
        <Text>Oatmeal row</Text>
      </ContextMenu>,
    );
    expect(view.getByText('Oatmeal row')).toBeTruthy();
  });
});
