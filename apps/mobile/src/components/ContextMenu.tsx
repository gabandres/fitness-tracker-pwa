import { type ReactNode, useId, useState } from 'react';
import { Platform } from 'react-native';
// expo-router's own native context-menu views, used directly rather than
// through `<Link>` (UX_AUDIT S20). `Link` lays its wrapper out as
// `display: contents`, and VoiceOver does not descend through it: every row
// wrapped in a `Link.Menu` vanished for screen readers (measured on the iOS 26
// simulator — the row reappeared the moment the style was dropped). It also
// needs a route to navigate to, which a diary row is not. These three views
// are already compiled into the binary (`ExpoRouterNativeLinkPreview`), so this
// costs no native change. A deep import: if a future expo-router moves the
// file, `context-menu.test.tsx` fails on the import before anything ships.
import {
  NativeLinkPreview,
  NativeLinkPreviewAction,
  NativeLinkPreviewContent,
} from 'expo-router/build/link/preview/native';

export interface ContextMenuAction {
  key: string;
  title: string;
  /** SF Symbol name. */
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
}

/** Native context menus exist here: iOS, bridgeless — the same condition
 *  expo-router gates its native views on (they render null otherwise, which
 *  would take the row with them). Elsewhere callers keep their own long-press
 *  menu. */
export const CONTEXT_MENUS =
  Platform.OS === 'ios' && (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless === true;

/**
 * The system context menu (`UIContextMenuInteraction`) around one child: a
 * long-press lifts it, shows `preview` above and `actions` below, in Liquid
 * Glass on iOS 26. Tapping the preview calls `onPreviewPress` once the menu
 * has finished closing — the moment a sheet can be presented without fighting
 * the dismissal.
 *
 * The child stays a normal element: its own tap, its own accessibility label
 * and actions (VoiceOver users reach the same commands through the rotor —
 * the menu is a touch gesture). Off iOS it renders the child alone.
 */
export function ContextMenu({
  children,
  title,
  actions,
  preview,
  previewSize,
  onPreviewPress,
}: {
  children: ReactNode;
  title?: string;
  actions: ContextMenuAction[];
  preview?: ReactNode;
  previewSize?: { width: number; height: number };
  onPreviewPress?: () => void;
}) {
  const menuId = useId();
  // The preview mounts only while the menu is up — it is a second render of
  // the row's content, and a list of them would otherwise all be live.
  const [open, setOpen] = useState(false);
  if (!CONTEXT_MENUS) return <>{children}</>;
  return (
    <NativeLinkPreview
      nextScreenId={undefined}
      tabPath={undefined}
      onWillPreviewOpen={() => setOpen(true)}
      onPreviewDidClose={() => setOpen(false)}
      onPreviewTappedAnimationCompleted={onPreviewPress}
    >
      {children}
      {preview ? (
        <NativeLinkPreviewContent preferredContentSize={previewSize ?? { width: 0, height: 0 }}>
          {open ? preview : null}
        </NativeLinkPreviewContent>
      ) : null}
      <NativeLinkPreviewAction identifier={menuId} title={title ?? ''} onSelected={() => {}}>
        {actions.map((a) => (
          <NativeLinkPreviewAction
            key={a.key}
            identifier={`${menuId}-${a.key}`}
            title={a.title}
            icon={a.icon}
            destructive={a.destructive}
            onSelected={a.onPress}
          />
        ))}
      </NativeLinkPreviewAction>
    </NativeLinkPreview>
  );
}
