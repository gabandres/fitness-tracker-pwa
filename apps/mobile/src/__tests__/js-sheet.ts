/**
 * `jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule())`
 *
 * Renders a `BottomSheet native` as the JS sheet. jest-expo reports iOS, where
 * a native sheet renders NOTHING in place — it publishes its children to the
 * root `sheet` route (`lib/sheet-portal.ts`, UX_AUDIT S20), which a component
 * test does not mount. These suites test what is IN the sheet, not how iOS
 * presents it, so they get the in-place sheet every other platform draws.
 */
export function jsSheetModule() {
  const actual = jest.requireActual<typeof import('@/components/BottomSheet')>('@/components/BottomSheet');
  return {
    ...actual,
    BottomSheet: (props: Parameters<typeof actual.BottomSheet>[0]) => actual.BottomSheet({ ...props, native: false }),
  };
}
