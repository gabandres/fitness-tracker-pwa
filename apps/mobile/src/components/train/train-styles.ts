import { StyleSheet } from 'react-native';
import { type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * The Train tab's stylesheet, for the screen and every modal it opens.
 *
 * Extracted from `app/(app)/train.tsx` when that route passed 2,300 lines — the
 * densest file in the app by a factor of three, against a web Train tab that
 * had been split into a component and a session sheet since it was written.
 *
 * **One stylesheet, deliberately, and not one per component.** These styles are
 * heavily cross-used: the template editor borrows the set-row chips, the finish
 * modal borrows the confirm buttons, the exercise detail sheet borrows the card
 * frames. Splitting them per component would have meant either duplicating
 * rules (which drift) or inventing a shared base plus four leaves (which is the
 * same file with more indirection). The extraction is about the ROUTE's size,
 * not about the stylesheet's.
 *
 * Exported as the factory rather than the built sheet: `useThemedStyles` calls
 * it per theme, and ADR-0014 forbids reading a static palette.
 */
export const createStyles = ({ colors, scheme, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  // Pushed right so the title keeps the left edge and the help sits beside the avatar.
  headerHelp: { marginLeft: 'auto', marginRight: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
  empty: { fontSize: font.small, color: colors.muted },
  sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink, marginTop: space.sm },
  // Hero panel — the Today skeleton (ADR-0014 §7): shared dark canvas, the one
  // big number (workouts this week) with volume + top-set chips beneath.
  heroPanel: {
    backgroundColor: colors.heroPanel,
    borderRadius: radius.xl,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.xs,
    ...shadow.e2,
  },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
  heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
  heroUnit: { fontSize: font.h3, color: colors.heroMuted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
  heroHint: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs },
  heroChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
  trendChip: {
    fontSize: font.small,
    color: colors.heroMuted,
    backgroundColor: colors.heroTrack,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  trendChipValue: { color: colors.heroText, fontFamily: type.heading },
  startBtn: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  startBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  list: { gap: space.sm },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  histMain: { gap: 2 },
  histHint: { fontSize: font.tiny, color: colors.muted, marginBottom: space.xs },
  histDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  histSub: { fontSize: font.small, color: colors.muted },
  histVol: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  // active
  activeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeText: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  savingText: { fontSize: font.tiny, color: colors.faint },
  progressText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  exName: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
  exCount: { backgroundColor: colors.inputBg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3, minWidth: 44, alignItems: 'center' },
  exCountText: { fontSize: font.small, fontWeight: '800', color: colors.muted },
  exDone: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  exChevron: { marginLeft: 2 },
  exRemoveRow: { alignSelf: 'flex-start', paddingVertical: space.sm, marginTop: space.xs },
  exCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
  },
  exRemove: { fontSize: font.tiny, color: colors.danger, fontWeight: '700', textTransform: 'uppercase' },
  setHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setHeadCell: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setNumCell: { width: 24 },
  setNum: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  setNumCluster: { color: colors.accent, fontWeight: '800' },
  kindPicker: { paddingVertical: space.sm, gap: space.xs },
  kindPickerLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  kindChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
  },
  kindChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  kindChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  kindChipTextOn: { color: colors.onInk },
  // Set-type rows carry a description under each name, so they are stacked
  // rows rather than the compact chips the RIR scale uses.
  prHint: { fontSize: font.tiny, color: colors.faint, marginTop: 1, textAlign: 'center' },
  progRule: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs, lineHeight: 16 },
  kindRow: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm },
  kindRowOn: { backgroundColor: colors.inputBg },
  kindRowName: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  kindRowNameOn: { color: colors.accent },
  kindRowDesc: { fontSize: font.tiny, color: colors.muted, marginTop: 1 },
  // The RIR cell is a picker trigger, not a text field — same box, centred
  // value, so the row's geometry is unchanged.
  setRirBtn: { alignItems: 'center', justifyContent: 'center' },
  setRirValue: { fontSize: font.body, color: colors.ink },
  setRirEmpty: { color: colors.faint },
  setInputCell: { width: 62, textAlign: 'center' },
  setRirCell: { width: 40, textAlign: 'center' },
  setInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
  },
  setDoneCell: { width: 32, alignItems: 'center' },
  doneBox: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  doneBoxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  doneCheck: { color: colors.line, fontWeight: '800' },
  doneCheckOn: { color: colors.onInk },
  setDel: { paddingHorizontal: space.xs },
  setDelText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addSetRow: { flexDirection: 'row', gap: space.xl },
  addSetBtn: { paddingVertical: space.sm },
  addSetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  addExBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  addExText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  footerBtns: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  discardBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  discardText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  finishBtn: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  finishText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  // modal
  // The backdrop / wrapper / panel / handle all live in `<BottomSheet>` now —
  // Train's four sheets hand-rolled a `Modal animationType="slide"`, which
  // slides the dim backdrop UP THE SCREEN with the panel and offers no
  // drag-to-dismiss. What survives here is only what genuinely differs from
  // the shared default, passed as `contentStyle`: a `gap` between the panel's
  // direct children and a slightly taller `paddingTop`. The 80% ceiling is a
  // `maxHeight` prop at each call site, for the same reason — a Train picker
  // that covers the whole screen stops reading as a sheet.
  sheetBody: { paddingTop: space.md, gap: space.sm },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  sheetHint: { fontSize: font.small, color: colors.muted },
  sheetEmpty: { fontSize: font.small, color: colors.muted, paddingVertical: space.lg, textAlign: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  // marginTop lives here, not at the call sites: the row always follows the
  // exercise-name input, and both sheets used to space it themselves — the add
  // sheet not at all, so the chips sat flush against the field.
  styleRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  styleChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  styleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  styleChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  styleChipTextOn: { color: colors.onInk },
  createRow: { paddingVertical: space.sm },
  createText: { fontSize: font.body, color: colors.accent, fontWeight: '700' },
  catalogList: { maxHeight: 220 },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  catalogName: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  catalogStyle: { fontSize: font.tiny, color: colors.muted },
  finishScroll: { gap: space.sm },
  finishRow: { flexDirection: 'row', gap: space.md },
  finishField: { flex: 1, gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  // templates
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  sectionActions: { flexDirection: 'row', gap: space.lg },
  sectionAction: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  tplMain: { flex: 1, gap: 2 },
  // Same gap as `list`, for the starter sheet's scroll content. The title and
  // hint are children of the same container, so they gain it too — which is
  // what they wanted anyway.
  starterList: { gap: space.sm },
  tplStart: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  tplStartText: { color: colors.onInk, fontWeight: '700', fontSize: font.small },
  // template editor
  notesInput: { minHeight: 56, textAlignVertical: 'top' },
  tplExCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
    marginBottom: space.sm,
  },
  tplExTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  /** The tappable part of a card header: everything but the drag grip. Row, so
   *  the chevron rides at the far edge and is INSIDE the touchable. */
  tplExTapRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  /** Fills the modal so the sheet keeps its own absolute/backdrop layout. */
  // `flexShrink: 1`, NOT `flex: 1` — and the device is what proved it. This
  // root used to be the direct child of a full-screen `Modal`, where `flex: 1`
  // meant "the whole screen". Inside `<BottomSheet>`'s panel, whose height is
  // content-driven, `flex: 1` means flexBasis 0 — so the editor rendered as a
  // bare handle above an empty strip. Shrink-only sizes it to its content and
  // still lets it give way to the panel's clamp, which is what bounds the
  // ScrollView inside it.
  ghRoot: { flexShrink: 1 },
  tplReorder: { marginTop: -2 },
  /** The drag grip. 44pt tall so the gesture has a real target — the ▲▼ pair
   *  it replaced were 20pt each. */
  tplDragHandle: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  tplMoveBtn: { paddingHorizontal: 2, paddingVertical: 1 },
  tplExName: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
  tplExMeta: { fontSize: font.small, color: colors.muted, marginTop: 1 },
  tplDel: { padding: space.xs },
  tplExControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  tplLoadWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tplLoadUnit: { fontSize: font.small, color: colors.muted },
  tplSetsLabel: { fontSize: font.small, color: colors.muted },
  // template editor — rest timers, progression, per-set rows
  restRow: { flexDirection: 'row', gap: space.md },
  restCell: { flex: 1 },
  progToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  progToggleText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  progRow: { flexDirection: 'row', gap: space.sm },
  progCell: { flex: 1, gap: space.xs },
  tplSetRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  tplSetKind: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.inputBg,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  tplSetKindText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  // The set table. Cells share one width contract so the header sits over the
  // column it names: fixed number + delete cells at the ends, the value cells
  // splitting what is left. 44pt tall — these are the most-tapped controls in
  // the tab and used to be 28.
  tplSetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  tplSetHeadCell: {
    fontSize: font.tiny,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  tplSetNumCell: { width: 40, alignItems: 'center', justifyContent: 'center' },
  tplSetNum: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
  /** Printed under the number only for a non-`working` kind, so the common
   *  row stays a bare number and an unusual one still names itself. */
  tplSetKindTag: { fontSize: 10, color: colors.muted, marginTop: -1 },
  tplSetCell: { flex: 1 },
  tplSetDelCell: { width: 26, alignItems: 'center', justifyContent: 'center' },
  tplSetInput: {
    height: 44,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    textAlign: 'center',
    fontSize: font.body,
    color: colors.ink,
  },
  tplSetGroup: { flex: 1, fontSize: font.tiny, color: colors.muted },
  tplSetBtns: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  // "More options" — the one level of depth everything optional lives behind.
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.sm,
  },
  moreText: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  moreBody: { gap: space.sm, paddingTop: space.xs },
  moreRemove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 44,
    marginTop: space.xs,
  },
  moreRemoveText: { fontSize: font.small, fontWeight: '700', color: colors.danger },
  tplLoadInput: {
    width: 64,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    textAlign: 'center',
    fontSize: font.body,
    color: colors.ink,
  },
  editorBtns: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  btnDisabled: { opacity: 0.4 },
  // plates & warm-up panel
  ghost: { fontSize: font.tiny, color: colors.muted, marginTop: 1 },
  bumpChip: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    backgroundColor: colors.ring,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  bumpText: { fontSize: font.tiny, color: colors.white, fontWeight: '800' },
  panelToggle: { paddingVertical: space.xs, alignSelf: 'flex-start' },
  panelToggleText: { fontSize: font.tiny, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  panel: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    gap: 2,
  },
  panelLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  plateText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  panelHint: { fontSize: font.small, color: colors.muted },
  warmRow: { fontSize: font.small, color: colors.ink },
  // rest timer bar
  restBarFloat: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    bottom: space.md,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...shadow.e3,
  },
  restLabel: { color: colors.onInk, fontWeight: '800', fontSize: font.body },
  restActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  restPlus: { color: colors.onInk, fontWeight: '700', fontSize: font.small, opacity: 0.85 },
  restSkip: { color: colors.ring, fontWeight: '800', fontSize: font.small, textTransform: 'uppercase', letterSpacing: 0.5 },
  // exercise library + detail
  exLibRow: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 2,
  },
  prRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  prCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    gap: 2,
  },
  prValue: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  prLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  chartWrap: { marginTop: space.md, gap: space.xs },
  detailRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailDate: { width: 56, fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailSets: { flex: 1, fontSize: font.small, color: colors.ink },
  manageRow: { flexDirection: 'row', gap: space.xl, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  manageLink: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  manageDanger: { color: colors.danger },
  confirmRow: { marginTop: space.md, gap: space.sm },
  confirmBtns: { flexDirection: 'row', gap: space.xl },
});
