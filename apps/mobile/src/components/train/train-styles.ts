import { StyleSheet } from 'react-native';
import { type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';
import { TAB_SCROLL_BAND } from '@/lib/glass';

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
/** The touch-target token, re-exported for Train's existing imports — it
 *  lives in `theme.ts` since 2026-10-06 (it was Train-local before). */
export { TARGET };

export const createStyles = ({ colors, scheme, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl },
  // The top padding is the ROW's, not the title's: on the title it pushed the
  // text's centre 6 pt below the icons' (`alignItems: 'center'`), where
  // Today's sit on the title line (S21 simulator QA).
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl, paddingTop: space.md },
  // Pushed right so the title keeps the left edge and the help sits beside the avatar.
  headerHelp: { marginLeft: 'auto', marginRight: space.xs, minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // See FAB_BAND — the + button overhangs every tab's scroll area.
  body: { padding: space.xl, paddingBottom: TAB_SCROLL_BAND, gap: space.md },
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
    // Dark: the panel sits ~1.02:1 on the canvas and read as floating text;
    // a hairline gives it an edge (train-ux H13). Light has the shadow.
    ...(scheme === 'dark' ? { borderWidth: 1, borderColor: colors.line } : null),
  },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
  heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
  heroUnit: { flexShrink: 1, fontSize: font.h3, color: colors.heroMuted, marginBottom: space.sm },
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
  // Shrinks, not the volume: at large text the name/date column used to push
  // the volume off the row's edge (train-ux v5 QA).
  histMain: { gap: 2, flex: 1, flexShrink: 1 },
  /** A history row plus its Android ⋯ (train-ux H6). */
  histRowWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  histHint: { fontSize: font.tiny, color: colors.muted, marginBottom: space.xs },
  histDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  histSub: { fontSize: font.small, color: colors.muted },
  histVol: { fontSize: font.small, fontWeight: '700', color: colors.ink, marginLeft: space.sm },
  // active
  activeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeText: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  savingText: { fontSize: font.tiny, color: colors.faint },
  progressText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  exHeadRow: { flexDirection: 'row', alignItems: 'center' },
  // Large text: the name takes the whole first line and the count, chevron
  // and ⋯ wrap under it, right-aligned — "Romani / an / Deadlift" broke
  // mid-word beside them (L5). The ⋯ is pinned to that second line's right
  // end, and the tail leaves it room.
  exHeadWrap: { flexWrap: 'wrap', justifyContent: 'flex-end' },
  exNameWrap: { flexBasis: '100%' },
  exHeadTail: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  exHeadTailWrap: { minHeight: TARGET, marginRight: TARGET },
  exMoreBtnWrap: { position: 'absolute', right: 0, bottom: 0 },
  exHead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
  exName: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
  // Teal, not accent: a LABEL ("A1 · SUPERSET") must not look like the accent
  // warnings beside it (`supersetWarn`). Teal is AA as text in both themes.
  supersetTag: { fontSize: font.tiny, color: colors.teal, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  /** The superset's members in the workout and the editor: one rail down the
   *  left of every member card, so a pair reads as one block. */
  supersetRail: { borderLeftWidth: 3, borderLeftColor: colors.teal },
  /** "Superset A · switch 0:30 · round 0:30", above the block's first card. */
  supersetHeader: { fontSize: font.small, fontWeight: '700', color: colors.teal, marginTop: space.sm, marginBottom: space.xs },
  /** The card the running rest leads into. A filled chip: `onFill` on `tealSolid`. */
  upNextBadge: { alignSelf: 'flex-start', backgroundColor: colors.tealSolid, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, marginBottom: 2 },
  upNextText: { fontSize: font.tiny, fontWeight: '800', color: colors.onFill, textTransform: 'uppercase', letterSpacing: 0.5 },
  /** One warning line under a superset: icon + text, wrapping. */
  supersetWarnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  /** A superset action on a collapsed editor card: 44pt, icon only. */
  supersetLinkBtn: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  /** An L/R lift's side above its own call (Program v2). */
  sideLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  // superset report
  reportMetric: { gap: 2 },
  reportMetricLabel: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  reportMetricValue: { fontSize: font.body, color: colors.ink, lineHeight: 22 },
  reportFlag: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, padding: space.md },
  reportFlagText: { fontSize: font.small, color: colors.ink, lineHeight: 20 },
  reportNote: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  // drafts
  draftSummary: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  draftTop: { alignItems: 'flex-start' },
  draftOrderRow: { flexDirection: 'row' },
  /** The "A1" column of a draft's order: grows at large text, never clips. */
  draftOrderLabel: { minWidth: 32, paddingRight: space.xs, lineHeight: 20 },
  draftDeleteLink: { minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.sm },
  // The hairline keeps the pill visible in dark mode, where `inputBg` is the
  // card's own fill (L14).
  exCount: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3, minWidth: 44, alignItems: 'center' },
  exCountText: { fontSize: font.small, fontWeight: '800', color: colors.muted },
  exDone: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  exChevron: { marginLeft: 2 },
  // 44-pt targets (UX_AUDIT S18-15) on the editor's text-only actions.
  exRemoveRow: { alignSelf: 'flex-start', minHeight: TARGET, justifyContent: 'center', paddingVertical: space.sm, marginTop: space.xs },
  exCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
  },
  exRemove: { fontSize: font.small, color: colors.danger, fontWeight: '700' },

  // ── cardio (ADR-0025) ──
  // Shares `exCard`'s frame on purpose: a cardio block and an exercise are
  // peers inside one session, and giving cardio its own card treatment would
  // make it read as a different feature bolted on beside Train.
  cardioHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
  cardioName: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink, flexShrink: 1 },
  cardioSummary: { fontSize: font.small, color: colors.muted, marginTop: 2 },
  cardioFieldRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' },
  cardioField: { flex: 1, gap: space.xs },
  cardioLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  cardioInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
    textAlign: 'center',
  },
  // Provenance, not decoration: this chip is what makes an imported block read
  // as "your ring recorded this" rather than as something the app invented.
  cardioVia: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.inputBg,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  cardioViaText: { fontSize: font.tiny, color: colors.muted, fontWeight: '700' },
  // The ring's calorie number and, directly under it, why it is not a budget.
  // The two are one unit — the number alone invites exactly the double-count
  // ADR-0024 decision 4 forbids.
  cardioKcal: { fontSize: font.small, color: colors.ink, fontWeight: '700', marginTop: space.xs },
  cardioKcalWhy: { fontSize: font.tiny, color: colors.faint, lineHeight: 15, marginTop: 2 },
  cardioWarn: { fontSize: font.tiny, color: colors.muted, lineHeight: 15, marginTop: space.xs },
  cardioTarget: { fontSize: font.tiny, color: colors.teal, fontWeight: '700' },
  modalityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  setHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  setHeadCell: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // 44pt tall, and a MIN width: the set number is the set sheet's trigger and
  // was a 24×20 target (Train review item 16). minWidth so a scaled "2a"
  // grows the cell instead of clipping (item 17).
  //
  // 30 wide plus an 8pt slop each side: 46pt of target, past HIG's 44 on
  // the axis that was short, without taking 16pt from the number fields
  // (Train re-score 3). The slop's right edge lands on PREVIOUS, which has
  // no target of its own. Was 36: the 6pt went to the RIR cell (F13).
  setNumCell: { minWidth: 30, minHeight: TARGET, justifyContent: 'center' },
  // The "#" header over that column: the same width so the columns line up,
  // but NOT the 44pt height — on a Text, `justifyContent` does not centre the
  // glyph, so "#" drew at the top of a 44pt box, above PREV/LB/REPS/RIR and
  // crowding the line over the table (Maestro captures, 2026-10-04).
  setNumHead: { minWidth: 30 },
  setNum: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  setNumCluster: { color: colors.teal, fontWeight: '800' },
  kindPicker: { paddingVertical: space.sm, gap: space.xs },
  kindPickerLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  // The sheets' choice chips (RIR scale, rest picker, cardio modality,
  // muscles). A full TARGET tall, in rows `space.sm` apart. They were ~24pt
  // boxes lifted to 44 with 11pt of hitSlop in rows 4pt apart, so each chip's
  // slop reached into the row above and below and a tap near the seam could
  // land on the neighbour (UX_AUDIT S20). Real size, no slop: the targets
  // tile without overlapping.
  kindChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kindChip: {
    minHeight: TARGET,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
  },
  kindChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  kindChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  kindChipTextOn: { color: colors.onInk },
  // Set-type rows carry a description under each name, so they are stacked
  // rows rather than the compact chips the RIR scale uses.
  prHint: { fontSize: font.tiny, color: colors.faint, marginTop: 1, textAlign: 'left' },
  progRule: { fontSize: font.small, color: colors.muted, marginTop: space.xs, lineHeight: 20 },
  kindRow: { minHeight: TARGET, justifyContent: 'center', paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm },
  kindRowOn: { backgroundColor: colors.inputBg },
  kindRowName: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  kindRowNameOn: { color: colors.teal },
  // A sentence, so body-small, not 12pt (J9 / R8).
  kindRowDesc: { fontSize: font.small, color: colors.muted, marginTop: 1 },
  // The RIR cell is a picker trigger, not a text field — same box, centred
  // value, so the row's geometry is unchanged.
  setRirBtn: { alignItems: 'center', justifyContent: 'center', minHeight: TARGET },
  setRirValue: { fontSize: font.body, color: colors.ink },
  setRirEmpty: { color: colors.faint },
  // FLEX, not a fixed width. The row gained a PREVIOUS column, and 24 + 62 +
  // 62 + 62 + 40 + 32 plus five gaps overflows the 312dp of content a 360dp
  // screen has — which is the LG VS988, the narrowest device this ships to.
  // Flexing the two number cells makes the row fit any width by construction
  // instead of by a measurement that only held on one phone.
  setInputCell: { flex: 1, minWidth: 44, textAlign: 'center' },
  // A full target WIDE as well as tall (R1; it was 37-38pt and passed only on
  // the WCAG spacing exception, F13). Paid for by the set number (−6) and
  // PREVIOUS (−4), so the row's fixed width did not grow on either platform.
  setRirCell: { minWidth: TARGET, textAlign: 'center' },
  // `lineStrong`, not `line`: a field's boundary has to meet WCAG 1.4.11's
  // 3:1, and `line` on the input fill measured 1.17:1 dark / 1.27:1 light —
  // the boxes were invisible in a bright gym (Train review item 13).
  setInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    // The platform target, not ~38pt of padding plus a line (Train UX pass
    // L3): free on iOS, where the row is already 44 from the done cell.
    minHeight: TARGET,
    fontSize: font.body,
    // Columns of loads and reps line up digit for digit.
    fontVariant: ['tabular-nums'],
    color: colors.ink,
  },
  // A ticked set's fields read as settled text — no box — so a done row
  // differs from an open one in shape, not only in the grey of a
  // placeholder (L13). Still editable.
  setInputDone: { borderColor: 'transparent', backgroundColor: 'transparent' },
  setNumDone: { color: colors.ink, fontWeight: '800' },
  // The cell is the 44pt target; the box inside it is what is drawn.
  setDoneCell: { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  doneBox: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  doneBoxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  doneCheck: { color: colors.line, fontWeight: '800' },
  doneCheckOn: { color: colors.onInk },
  setDel: { paddingHorizontal: space.xs },
  setDelText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addSetRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl },
  addSetBtn: { minHeight: TARGET, justifyContent: 'center', paddingVertical: space.sm },
  addSetText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  addExBtn: {
    minHeight: TARGET,
    justifyContent: 'center',
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
  /** Cancel beside a Save: neutral, never the destructive outline — Cancel
   *  keeps what was saved (train-ux X12, R37). */
  cancelBtn: {
    minHeight: TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: colors.ink, fontWeight: '700', fontSize: font.body },
  finishBtn: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, paddingHorizontal: space.md, alignItems: 'center' },
  // Centred when it wraps ("Complete / workout" at accessibility sizes was flush left).
  finishText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3, textAlign: 'center' },
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
    borderColor: colors.lineStrong,
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
    minHeight: TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  // Four chips will not fit one row at 360 dp: the label "Weight x reps" alone
  // is wider than the ~76 dp each would get, so it wraps mid-label and the row
  // reads as broken rather than dense. These two turn the FOUR-chip rows into a
  // 2x2 grid with every label on one line. Applied only where four render —
  // the three-chip rows keep the single row, because 47% basis would break
  // them into an ugly 2+1.
  styleRowWrap: { flexWrap: 'wrap' },
  styleChipHalf: { flexBasis: '47%' },
  styleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  styleChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  styleChipTextOn: { color: colors.onInk },
  createRow: { minHeight: TARGET, justifyContent: 'center', paddingVertical: space.sm },
  createText: { fontSize: font.body, color: colors.teal, fontWeight: '700' },
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
  // Wraps at large text: "Templates" ran into "Starters" at 200% (Android
  // QA, UX_AUDIT S22). The actions then take their own line, still at the
  // right (`marginLeft: 'auto'`).
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    marginTop: space.sm,
  },
  sectionActions: { flexDirection: 'row', gap: space.lg, marginLeft: 'auto' },
  sectionAction: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  /** The touchable around a text action: 44pt tall whatever the text is
   *  (Train review item 16 — these measured ~18-34pt). Row, so an icon can
   *  lead the label where a "+" used to be typed into the string. */
  textAction: { minHeight: TARGET, flexDirection: 'row', alignItems: 'center', gap: space.xs },
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
  /** A template row as a card: the edit button and Start on top, the "Next
   *  session" toggle and its list under them — siblings, not nested. */
  tplCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.md,
  },
  tplCardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  // Same gap as `list`, for the starter sheet's scroll content. The title and
  // hint are children of the same container, so they gain it too — which is
  // what they wanted anyway.
  starterList: { gap: space.sm },
  // The same primary as Next up's Start, at row size: ink fill, onInk text,
  // the `md` radius, 44pt tall. It was a 33pt `sm` chip in a smaller type.
  tplStart: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: TARGET,
    justifyContent: 'center',
  },
  tplStartText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
  /** The first exercises of a template, under its name — "Bench · Row ·
   *  Squat +2" — so a row says what it IS, not just how big it is. */
  tplExNames: { fontSize: font.small, color: colors.ink },
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
  tplExTapRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
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
  tplDragHandle: { width: 32, minHeight: TARGET, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  tplMoveBtn: { paddingHorizontal: 2, paddingVertical: 1 },
  tplExName: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
  tplExMeta: { fontSize: font.small, color: colors.muted, marginTop: 1 },
  // ADR-0028's dose note. Muted rather than an alert colour on purpose: it
  // cites evidence and does not cap the number, so dressing it as an error
  // would overstate what it knows about this particular movement.
  tplDoseNote: { fontSize: font.small, color: colors.muted, marginTop: 4, lineHeight: 20 },
  /** A superset warning that asks for attention (same-muscle pair, a load
   *  test pending): the accent, never danger — saving is still allowed. */
  supersetWarn: { fontSize: font.small, color: colors.warn, fontWeight: '600', lineHeight: 20, flexShrink: 1 },
  tplDel: { padding: space.xs },
  tplExControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  tplLoadWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tplLoadUnit: { fontSize: font.small, color: colors.muted },
  tplSetsLabel: { fontSize: font.small, color: colors.muted },
  // template editor — rest timers, progression, per-set rows
  restRow: { flexDirection: 'row', gap: space.md },
  // Inputs on one baseline when one label wraps ("Rest between exercises (s)",
  // Train UX v2 QA): the row stretches both cells, each sits its field at the bottom.
  restCell: { flex: 1, justifyContent: 'flex-end' },
  progToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET, paddingVertical: space.xs },
  progToggleText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  progRow: { flexDirection: 'row', gap: space.sm },
  // Bottom-aligned: a label that wraps ("Workouts in a row") must not lift its
  // input above the other two (train-ux T20).
  progCell: { flex: 1, gap: space.xs, justifyContent: 'flex-end' },
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
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  // 76 wide so a kind tag ("Activation") prints whole rather than "Activ…",
  // and TARGET tall as a real target rather than a 22pt cell plus slop
  // (train-ux T4, T11).
  tplSetNumCell: { width: 76, minHeight: TARGET, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  tplSetNum: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
  /** Printed under the number only for a non-`working` kind, so the common
   *  row stays a bare number and an unusual one still names itself. */
  tplSetKindTag: { fontSize: font.tiny, color: colors.muted, marginTop: -1 },
  tplSetCell: { flex: 1 },
  // TARGET wide with no slop: the slop reached into the reps field (T4).
  tplSetDelCell: { width: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  // minHeight, not height: a fixed 44 clipped the digits at large Dynamic
  // Type / Android font scale. Grows with the text instead.
  tplSetInput: {
    minHeight: TARGET,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    textAlign: 'center',
    fontSize: font.body,
    color: colors.ink,
  },
  tplSetGroup: { flex: 1, fontSize: font.tiny, color: colors.muted },
  // Wraps: three add buttons ran off the right edge on a 402pt phone (Maestro 18).
  tplSetBtns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, marginTop: space.xs },
  // ADR-0040 structure picker. Wraps rather than scrolls: eight chips do not
  // fit one row at 360 dp, and a horizontal scroller hides the options that
  // matter most behind a gesture nobody discovers.
  tplStructureLabel: {
    fontSize: font.small, color: colors.muted, fontWeight: '700',
    marginTop: space.md, marginBottom: space.xs,
  },
  // Same rule as `kindChips`: real TARGET-tall chips, no overlapping slop.
  tplStructureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Bordered: `inputBg` on `card` is 1.00:1 in dark, so a borderless chip
  // vanished (train-ux T12). Selected = the teal FILL with `onFill` (ADR-0014).
  tplStructureChip: {
    minHeight: TARGET, justifyContent: 'center',
    paddingVertical: space.xs, paddingHorizontal: space.sm,
    borderRadius: radius.sm, backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.lineStrong,
  },
  tplStructureChipOn: { backgroundColor: colors.tealSolid, borderColor: colors.tealSolid },
  tplStructureText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  tplStructureTextOn: { color: colors.onFill },
  tplStructureNote: { fontSize: font.tiny, color: colors.muted, marginTop: -1 },
  // "More options" — the one level of depth everything optional lives behind.
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TARGET,
    marginTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.sm,
  },
  moreText: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  // Context-menu previews (a template, a logged workout): the card, opened up.
  preview: { flex: 1, backgroundColor: colors.paper, padding: space.xl, gap: space.xs },
  previewTitle: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 22 },
  previewBlock: { gap: 2, marginTop: space.xs },
  previewName: { flexShrink: 1, flex: 1, fontSize: font.body, fontWeight: '600', color: colors.ink },
  // The session preview stacks name over sets in a COLUMN, where `flex: 1`
  // sized the name to 0 (train-ux H-N1).
  previewBlockName: { flex: 0, flexShrink: 0 },
  previewMeta: { fontSize: font.small, color: colors.muted, fontVariant: ['tabular-nums'] },
  // The Finish sheet's record heading.
  prHero: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  prHeroText: { flex: 1, fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
  /** A checkbox row in a sheet — the rest picker's "Keep for this lift". */
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET, marginTop: space.xs },
  moreBody: { gap: space.sm, paddingTop: space.xs },
  moreRemove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TARGET,
    marginTop: space.xs,
  },
  moreRemoveText: { fontSize: font.small, fontWeight: '700', color: colors.danger },
  // minWidth/minHeight, not a fixed 64×34: a target, and room at large text (T4).
  tplLoadInput: {
    minWidth: 64,
    minHeight: TARGET,
    alignSelf: 'flex-start',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    textAlign: 'center',
    fontSize: font.body,
    color: colors.ink,
  },
  editorBtns: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  btnDisabled: { opacity: 0.4 },
  // plates & warm-up panel
  ghost: { fontSize: font.tiny, color: colors.muted, marginTop: 1 },
  // Dark text on the coral, not white: white on `ring` measured 2.85:1, the
  // hero panel's near-black on it is ~6.6:1 in both themes (Train review
  // item 15). Tall enough to hit, where it was a ~20pt sliver.
  bumpChip: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    backgroundColor: colors.ring,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: 32,
    justifyContent: 'center',
  },
  bumpText: { fontSize: font.small, color: colors.heroPanel, fontWeight: '800' },
  // Why no load was recommended. Deliberately NOT a `bumpChip`: that is a
  // filled coral pill you tap to accept a suggestion, and this is the absence
  // of a suggestion — giving it a fill would make withheld advice look louder
  // than the advice itself. Matches scan.tsx's `hintRow`, the app's existing
  // inline-notice shape.
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    marginTop: space.xs,
  },
  // `font.small`, not `tiny` — theme.ts reserves tiny for uppercase eyebrow
  // labels and this is a sentence a human reads.
  blockedText: { flex: 1, fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },

  // Progression engine (layer 6). The headline is the one line a lifter reads
  // between sets — load first, then the action in caps — so it takes the body
  // size; the reason and last-session lines sit under it in `small`, the
  // same sentence size as `blockedText`. An invalid read is muted rather than
  // coloured: it is the absence of a call, and must not read louder than one.
  recBlock: { marginTop: space.xs, gap: 2 },
  recCompact: { marginTop: 2, gap: 1 },
  recHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  recHeadline: { fontSize: font.small, color: colors.ink, fontWeight: '800', letterSpacing: 0.3 },
  recHeadlineInvalid: { color: colors.muted },
  recReason: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
  recLast: { fontSize: font.tiny, color: colors.faint, marginTop: 1 },
  recStall: { marginTop: space.xs, gap: 1, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: space.sm },
  recStallHead: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  recStallLine: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
  // ADR-0039: a soft warning (a rir1 lift taken to failure) reads in ink, not
  // muted — it is advice about the NEXT set, not the absence of a call. The
  // calibration count under an invalid read is muted like the reason.
  recWarnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, marginTop: 2 },
  recWarnText: { flex: 1, fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
  recCalib: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
  recGear: { marginLeft: 'auto', minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  // Lift settings sheet: effort standard chips + the band override field.
  liftSection: { marginTop: space.md, gap: space.xs },
  liftLabel: { fontSize: font.tiny, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  liftHint: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
  liftBandRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  liftBandInput: { width: 84, textAlign: 'center' },
  liftBandUnit: { fontSize: font.small, color: colors.muted },
  liftClear: { alignSelf: 'flex-start', minHeight: TARGET, justifyContent: 'center' },
  // `accent`, the coral that is AA as text; `ring` is a fill colour and read
  // ~2.4:1 on the light sheet.
  // A link, so teal like every other — the brand red is for PRs (train-ux J8).
  liftClearText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  // "Next session" under a template row — the engine's calls before the
  // session starts. Collapsed by default so the template list stays a list.
  tplNextToggle: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  /** "Next session" under a template row: a sibling of the row's edit button,
   *  not a control nested inside it, which VoiceOver could not reach. */
  tplNextToggleBtn: { minHeight: TARGET, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: space.lg },
  tplNext: { gap: space.sm, paddingTop: space.sm, paddingHorizontal: space.lg },
  tplNextRow: { gap: 1 },
  tplNextName: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  tplWrap: { gap: 0 },
  // Weekly cluster audit (layer 5) — one chip per muscle under the hero.
  auditWrap: { marginTop: space.sm, gap: space.xs },
  auditTitle: { fontSize: font.tiny, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  auditRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  auditChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: space.sm, paddingVertical: 2, backgroundColor: colors.card,
  },
  auditChipOff: { borderStyle: 'dashed' },
  auditMuscle: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  auditCount: { fontSize: font.small, color: colors.muted },
  auditHint: { fontSize: font.tiny, color: colors.faint },

  // Session roll-up above the Complete button. Same shape as scan.tsx's
  // `lowConf` notice, which does the identical job: a caution about the result
  // you are accepting, sitting above the primary action. `inputBg` rather than
  // `paper` because the sheet panel IS paper — a paper box on a paper sheet is
  // an invisible box. Dark mode is the other way round: the native sheet is
  // `card`, which `inputBg` matches there, so the box takes `paper` (F8).
  // Finish sheet: a lift with blank RIRs and its "Set to 0" (2026-10-15).
  rirMissingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rirMissingBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  rirMissingBtnText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  invalidBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: scheme === 'dark' ? colors.paper : colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  invalidHeading: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: space.xs,
  },
  invalidRow: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
  invalidName: { fontWeight: '700' },
  invalidHint: { fontSize: font.small, color: colors.muted, marginTop: space.xs },
  panelToggle: { paddingVertical: space.xs, alignSelf: 'flex-start' },
  panelToggleText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
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
  // Lifted clear of the raised Log button: it overhangs the screen by
  // `space.xl + 2` (LogSpeedDial's negative margin), and at `bottom: 12` it sat
  // on the bar's centre — over the countdown itself (Train review item 27).
  /** The rest bar's "Next: A2 · Leg Curls" line: its own full-width row,
   *  `onInk` on the `ink` bar (`muted` measured ~2:1 there), allowed two
   *  lines so the station name is never the part cut off. */
  restNext: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
  restBarFloat: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    bottom: space.xl + space.md,
    zIndex: 20,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.xs,
    overflow: 'hidden',
    ...shadow.e3,
  },
  restBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Tabular figures, so the countdown does not jitter as 1:11 becomes 1:10.
  restLabel: { color: colors.onInk, fontWeight: '800', fontSize: font.body, fontVariant: ['tabular-nums'] },
  // The countdown is a button now — it opens this lift's rest picker (L16).
  restLabelBtn: { minHeight: TARGET, alignItems: 'center' },
  restActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  restBtn: { minHeight: TARGET, minWidth: TARGET, justifyContent: 'center', alignItems: 'center' },
  restPlus: { color: colors.onInk, fontWeight: '700', fontSize: font.small, opacity: 0.85, fontVariant: ['tabular-nums'] },
  // onInk, not `ring`: coral on the light `ink` of the dark theme read 2.5:1.
  restSkip: { color: colors.onInk, fontWeight: '800', fontSize: font.small, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Progress through the rest: a track and a fill, redrawn per tick (no
  // animation, so Reduce Motion has nothing to turn off).
  restTrack: { height: 3, borderRadius: 2, backgroundColor: colors.onInk, opacity: 0.25 },
  restFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: colors.ring },
  restTrackWrap: { height: 3, marginBottom: space.xs },
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
  // A floor, not a width: "Sept 30" at large text clipped in 56 pt (train-ux X15).
  detailDate: { minWidth: 56, fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailSets: { flex: 1, fontSize: font.small, color: colors.ink },
  // A logged workout's exercise: the name on its own line (two at most), the
  // sets under it — not the 56pt date column `detailDate` is sized for.
  detailExRow: { gap: 2, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailExName: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  manageRow: { flexDirection: 'row', gap: space.xl, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  manageLink: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  // Square floor too: "Edit" was a ~30 pt-wide target (train-ux X13).
  manageBtn: { minHeight: TARGET, minWidth: TARGET, justifyContent: 'center', alignItems: 'center' },
  manageDanger: { color: colors.danger },
  confirmRow: { marginTop: space.md, gap: space.sm },
  confirmBtns: { flexDirection: 'row', gap: space.xl },

  // ── Next up (the home screen's one question) ──
  nextCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
    ...shadow.e1,
  },
  nextCaption: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nextName: { fontFamily: type.display, fontSize: font.h2, color: colors.ink },
  nextMeta: { fontSize: font.small, color: colors.muted, marginBottom: space.md },
  // The empty-workout escape hatch. A LINK, not a button: it starts a session
  // with nothing in it, which is the rarest path anyone takes and used to be
  // the most prominent control on the tab.
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xl,
    paddingVertical: space.sm,
  },
  secondaryLink: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  secondaryBtn: { minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.sm },

  // ── Exercise search (catalog + shipped library) ──
  searchGroup: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  searchMain: { flex: 1, gap: 2 },
  searchMuscles: { fontSize: font.tiny, color: colors.muted },
  // A search row with a multi-pick tick at its end (the in-session add
  // sheet): the pair shares the row's rule, the row keeps its own target.
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pickRowMain: { flex: 1, borderBottomWidth: 0 },
  // `finishBtn` is flex: 1 for a button row; alone in a column it must not grow.
  addPickedBtn: { flex: 0, paddingVertical: space.md },

  // ── Per-exercise overflow menu ──
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  menuMain: { flex: 1, gap: 2 },
  menuLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  menuLabelDanger: { color: colors.danger },
  menuDesc: { fontSize: font.small, color: colors.muted },
  exMoreBtn: { paddingHorizontal: space.xs, paddingVertical: space.xs },

  // ── Set-row sheet ──
  setSheetGap: { marginTop: space.lg },
  setSheetTail: { height: 24 },

  // ── The PREVIOUS column ──
  // Non-interactive, and styled to say so: it is the number to match or beat,
  // not a field. Right-aligned against the input beside it so the two read as
  // a comparison rather than as two entries.
  setPrevCell: { width: 52, paddingHorizontal: 2 },
  setPrevText: { fontSize: font.tiny, color: colors.muted, textAlign: 'center' },
  setPrevEmpty: { color: colors.faint },
  // Swipe-left reveal behind a set row.
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    marginBottom: space.xs,
    borderRadius: radius.sm,
  },

  // ── Structure-first template card ──
  // A real target (was ~24pt) and sentence-size text — 12pt is for labels,
  // not sentences (train-ux T4, T21).
  tplStructureMore: { minHeight: TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  tplStructureMoreText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  tplStructureDesc: { fontSize: font.small, color: colors.muted, marginTop: space.xs, lineHeight: 20 },
  /** The structure, folded to one line once chosen (train-ux T6).
   *  `alignContent: 'center'`: a WRAPPING row packs its lines at the top of
   *  the 44pt box (`alignContent` defaults to flex-start; `alignItems` only
   *  centres within a line), so the text rode ~13pt high and the air sat
   *  under it, above "Lift settings" (train-ux v4 #7b, measured on iOS v5).
   *  Centred, the same air would move ABOVE the line instead, so the row
   *  also tucks up into the card's gap (−8 for the old +4: the text keeps
   *  its distance from the header, the 44pt target stays whole). */
  tplStructureCompact: {
    flexDirection: 'row', alignItems: 'center', alignContent: 'center', flexWrap: 'wrap',
    columnGap: space.sm, minHeight: TARGET, marginTop: -space.sm,
  },
  tplStructureCompactText: { flexShrink: 1, fontSize: font.small, color: colors.ink, fontWeight: '600' },
  tplStructureKept: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs, fontStyle: 'italic' },
  tplOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: TARGET,
    paddingVertical: space.md,
    marginTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tplOptionsText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },

  // ── Live session header (Train review item 5) ──
  // Outside the ScrollView, so the workout's name, clock, volume and Finish
  // stay put while the sets scroll under them — Finish used to be the last
  // thing on the page, under every exercise and both add buttons.
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
  },
  sessionHeaderMain: { flex: 1, gap: 2 },
  sessionHeaderWrap: { flexWrap: 'wrap', justifyContent: 'flex-end' },
  sessionHeaderMainFull: { flexBasis: '100%' },
  sessionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
  sessionMeta: { fontSize: font.small, color: colors.muted, fontVariant: ['tabular-nums'] },
  sessionEyebrow: { fontSize: font.tiny, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerIconBtn: { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  headerPrimary: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: TARGET,
    justifyContent: 'center',
  },
  headerPrimaryText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
  // Where a queued write is, in words: "Saved on this phone" offline,
  // "Saving…" while the server has not answered.
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  syncText: { fontSize: font.tiny, color: colors.muted },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  errorBtn: {
    minHeight: TARGET,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  // One add-button style, with the "+" as an icon rather than typed into the
  // string (Train review item 26).
  addExRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },

  // ── Number entry: the focused row's ± steppers (Train review item 6) ──
  stepRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, paddingVertical: space.xs },
  stepBtn: {
    minWidth: 64,
    minHeight: TARGET,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  stepText: { fontSize: font.small, color: colors.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Large text (fontScale ≥ 1.5): PREVIOUS moves to its own line above the
  // inputs instead of squeezing every cell into an unreadable column.
  setPrevLine: { fontSize: font.small, color: colors.muted, paddingLeft: space.xs },
  /** "RIR missing — enter it?" under a ticked set with a blank RIR. A link,
   *  not an alert: the engine reads the blank as 0 and nothing is blocked. */
  setRirMissing: { fontSize: font.small, color: colors.warn, fontWeight: '600', paddingLeft: space.xs, paddingVertical: 2 },

  // ── Records (Train review item 35) ──
  prBadge: {
    alignSelf: 'center',
    backgroundColor: colors.ring,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  prBadgeText: { fontSize: font.tiny, fontWeight: '800', color: colors.heroPanel },

  // ── Finish summary (Train review item 34) ──
  summaryGrid: { flexDirection: 'row', gap: space.sm },
  summaryTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.md,
    alignItems: 'center',
    gap: 2,
  },
  summaryValue: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink, fontVariant: ['tabular-nums'] },
  summaryLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  summaryLine: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
  summaryBest: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  // At accessibility text sizes three tiles side by side clipped their values;
  // stacked, each tile is a label/value row across the sheet (F17).
  summaryGridStacked: { flexDirection: 'column' },
  summaryTileRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg },
  // The Finish sheet's scroll and its pinned footer (train-ux F1/J1): Complete
  // was the last child of the scroll and opened below the fold on every
  // template workout. `flexGrow` rather than `flex: 1` so the JS sheet, whose
  // panel has no definite height, still sizes the scroll to its content.
  finishScrollFill: { flexGrow: 1, flexShrink: 1 },
  finishFooter: {
    paddingTop: space.md,
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  // Complete alone in a column: `finishBtn` is flex: 1 for a button row.
  finishFooterBtn: { flex: 0 },
  finishDiscardBtn: { minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },

  // Sheets whose content is several siblings: the gap the JS panel gets from
  // `sheetBody` is also needed inside the native sheet, which ignores
  // `contentStyle`. `flexShrink` so a ScrollView inside still clamps.
  sheetStack: { flexShrink: 1, gap: space.sm },
  showAllBtn: { minHeight: TARGET, justifyContent: 'center', alignItems: 'center' },

  // ── Collapsed cluster audit ──
  auditLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  auditLineText: { fontSize: font.small, color: colors.muted, flex: 1 },

  // ── Progression engine, rep-range rules (2026-10-07) ──
  // "Target: ≥ N reps" is the number the lifter aims at between sets, so it
  // reads in ink beside the muted reason; the expectation and the notes
  // (approximate, guessed step, techniques) are qualifiers and sit smaller.
  recTarget: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  recNote: { fontSize: font.tiny, color: colors.muted, lineHeight: font.tiny * 1.4 },
  // "Template: 25 lb" when it can still be taken — a link, like Add set.
  recTemplateLink: { color: colors.teal, fontWeight: '700' },
  // Finish sheet: one row per lift with a call, toggle on the right when the
  // call would move the template's load.
  callRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  callMain: { flex: 1, gap: 2 },
  callHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  callName: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  callChip: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  callChipMove: { color: colors.ink },
  callToggle: { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  callApplied: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  // The Apply button: the session's secondary action, outlined so Complete
  // stays the one filled button on the sheet.
  callApplyBtn: {
    alignSelf: 'flex-start',
    minHeight: TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    marginTop: space.xs,
  },
  callApplyText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  // ── Lift settings: the per-lift configuration sheet (2026-10-07) ──
  liftToggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  liftToggleText: { flex: 1, gap: 2 },
  liftToggleLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  // "What the engine uses": read-only, so a quiet inset rather than a card.
  liftEffective: {
    marginTop: space.md,
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
  },
  liftEffectiveLine: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
  // Template editor: the lift-settings entry on an open card, and a cluster's
  // label field under its first row.
  tplLiftBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: TARGET },
  // The template editor's Lift settings page: "‹ {template name}" back to the
  // editor, a full-width TARGET row (train-ux X6/T26).
  liftBackRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET, alignSelf: 'stretch' },
  liftBackText: { flexShrink: 1, fontSize: font.body, color: colors.teal, fontWeight: '600' },
  tplClusterLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl },
  tplClusterLabelInput: { width: 72, textAlign: 'center', paddingVertical: space.xs },
  // Exercise history: the template's load log, one move per row.
  loadLogRow: { gap: 2, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  loadLogHead: { flexDirection: 'row', gap: space.md },
  loadLogMove: { flex: 1, fontSize: font.small, color: colors.ink, fontWeight: '700' },
  loadLogMeta: { fontSize: font.tiny, color: colors.muted },
  // The volume panel's phase and volume-call lines, under the cluster chips.
  volumeLine: { fontSize: font.small, color: colors.ink },
  volumeNote: { fontSize: font.small, color: colors.muted },
});
