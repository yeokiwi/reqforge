"use client";

// The editor's two toolbar rows, in the order `10` §5.1 draws them:
//
//   Paragraph ▾ │ B I U │ A▾ Aᵃ▾ │ ≔ ⒈ ☑ │ ⇤ ⇥ │ ⫷ ⫸ ⫶ │ ▭ │ 🖼 🔗 ▦▾ ☺ │ + ▾ │ ↶ ↷           🔍 ?
//   Responsive ▾ │ ⤒row ⤓row ✕row │ ⇤col ⇥col ✕col │ merge split │ hdr-row hdr-col num │ fill ▾ │ ✕table
//
// Row 2 is rendered by the caller only while the selection is inside a table. Each glyph is read
// as RD-057 reads it; every control is a real button named from the copy deck (13.3), with
// aria-pressed where it toggles. Each row is a role=toolbar with arrow-key roving focus.
// What the commands do lives in commands.ts; this file only lays them out.
// spec: docs/specs/10-ui-reference.md section 5.1; docs/specs/09-decision-log.md section RD-057
import type { Editor } from "@tiptap/core";
import { type ReactNode, useRef } from "react";
import { t } from "@/copy";
import { ChevronDown, HelpIcon, SearchIcon } from "@/ui/icons";
import {
  BLOCK_STYLES,
  type BlockStyle,
  type TableToolbarState,
  type ToolbarState,
  clearFormatting,
  headingLevelOf,
  insertEmoji,
  insertTable,
  setAlignment,
  setBlockStyle,
  setCellBackground,
  setTableWidthMode,
  setTextColour,
  shiftIndent,
  toggleInfoPanel,
  toggleNumberedColumn,
} from "./commands";
import {
  AlignCentreIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ColumnAfterIcon,
  ColumnBeforeIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  DeleteTableIcon,
  EmojiIcon,
  FillIcon,
  HeaderColumnIcon,
  HeaderRowIcon,
  ImageIcon,
  IndentIcon,
  InfoPanelIcon,
  ItalicIcon,
  LinkIcon,
  MergeCellsIcon,
  MoreFormattingIcon,
  NumberedColumnIcon,
  OrderedListIcon,
  OutdentIcon,
  PlusIcon,
  RedoIcon,
  RowAboveIcon,
  RowBelowIcon,
  SplitCellIcon,
  TableIcon,
  TaskListIcon,
  TextColourIcon,
  UnderlineIcon,
  UndoIcon,
} from "./icons";
import { CELL_FILLS, TEXT_COLOURS } from "./palette";
import { EmojiGrid, TableSizeGrid } from "./pickers";
import { MenuItem, Popover } from "./popover";
import { useRovingToolbar } from "./roving";
import { ToolbarButton, ToolbarSeparator, ToolbarSlot } from "./toolbar-parts";

/** The name of a `Paragraph ▾` item. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`Paragraph ▾` = Normal, H1–H6, Quote, Preformatted)
export function blockStyleLabel(style: BlockStyle): string {
  const level = headingLevelOf(style);
  if (level !== null) return t("editor.style.heading", { level });
  switch (style) {
    case "quote":
      return t("editor.style.quote");
    case "preformatted":
      return t("editor.style.preformatted");
    default:
      return t("editor.style.normal");
  }
}

/** What the `Paragraph ▾` trigger shows: `Paragraph` for normal text, else the style. */
export function blockStyleTriggerText(style: BlockStyle): string {
  return style === "normal" ? t("editor.style.paragraph") : blockStyleLabel(style);
}

function Swatch({ colour }: { readonly colour: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-sm border border-slate-300"
      style={colour ? { backgroundColor: colour } : undefined}
    />
  );
}

function Toolbar({ label, testId, children }: { readonly label: string; readonly testId: string; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRovingToolbar(ref);
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-testid={testId}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      className="flex min-h-10 flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1"
    >
      {children}
    </div>
  );
}

export interface EditorToolbarProps {
  /** Null until the editor has mounted (it is never rendered on the server). */
  readonly editor: Editor | null;
  readonly state: ToolbarState | null;
  /** Nothing can be changed (an Update or a reload is in progress). */
  readonly readOnly: boolean;
  readonly onOpenLink: () => void;
  /** `🖼`: open the file picker (RD-058). Without it the control is drawn inert. */
  readonly onChooseFiles?: () => void;
  /** `+ ▾`: the Insert More Content menu (10 §5.5). Without it the control is drawn inert. */
  readonly insertMenu?: ReactNode;
  /** `🔍`: open or close the find bar (RD-057); `findOpen` is its pressed state. */
  readonly onToggleFind?: () => void;
  readonly findOpen?: boolean;
  /** `?`: the keyboard shortcuts (RD-057). */
  readonly onOpenShortcuts?: () => void;
}

// spec: docs/specs/10-ui-reference.md section 5.1 (toolbar row 1); RD-057
export function EditorToolbar({
  editor,
  state,
  readOnly,
  onOpenLink,
  onChooseFiles,
  insertMenu,
  onToggleFind,
  findOpen = false,
  onOpenShortcuts,
}: EditorToolbarProps) {
  const off = readOnly || editor === null || state === null;
  const run = (command: (editor: Editor) => unknown) => () => {
    if (editor && !off) command(editor);
  };
  const style = state?.blockStyle ?? "normal";
  const marks = state?.marks;
  const align = state?.align ?? null;

  return (
    <Toolbar label={t("editor.toolbar")} testId="editor-toolbar">
      <Popover
        kind="menu"
        label={t("editor.style.label")}
        valueText={blockStyleTriggerText(style)}
        disabled={off}
        roving
        keepEditorFocus
        triggerClassName="inline-flex h-8 w-36 items-center justify-between gap-1 rounded px-2 text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-expanded:bg-slate-200"
      >
        {BLOCK_STYLES.map((item) => (
          <MenuItem key={item} role="menuitemradio" checked={item === style} onSelect={run((e) => setBlockStyle(e, item))}>
            {blockStyleLabel(item)}
          </MenuItem>
        ))}
      </Popover>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.bold")} pressed={marks?.bold ?? false} disabled={off} onPress={run((e) => e.chain().focus().toggleBold().run())}>
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.italic")} pressed={marks?.italic ?? false} disabled={off} onPress={run((e) => e.chain().focus().toggleItalic().run())}>
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.underline")}
        pressed={marks?.underline ?? false}
        disabled={off}
        onPress={run((e) => e.chain().focus().toggleUnderline().run())}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <Popover kind="menu" label={t("editor.textColour")} icon={<TextColourIcon colour={state?.textColour ?? null} />} disabled={off} roving keepEditorFocus>
        <MenuItem role="menuitemradio" checked={(state?.textColour ?? null) === null} onSelect={run((e) => setTextColour(e, null))}>
          <Swatch colour={null} />
          {t("editor.textColour.default")}
        </MenuItem>
        {TEXT_COLOURS.map((swatch) => (
          <MenuItem key={swatch.hex} role="menuitemradio" checked={state?.textColour === swatch.hex} onSelect={run((e) => setTextColour(e, swatch.hex))}>
            <Swatch colour={swatch.hex} />
            {t(swatch.copy)}
          </MenuItem>
        ))}
      </Popover>
      <Popover kind="menu" label={t("editor.moreFormatting")} icon={<MoreFormattingIcon />} disabled={off} roving keepEditorFocus>
        <MenuItem role="menuitemcheckbox" checked={marks?.strike ?? false} onSelect={run((e) => e.chain().focus().toggleStrike().run())}>
          {t("editor.strike")}
        </MenuItem>
        <MenuItem role="menuitemcheckbox" checked={marks?.subscript ?? false} onSelect={run((e) => e.chain().focus().toggleSubscript().run())}>
          {t("editor.subscript")}
        </MenuItem>
        <MenuItem
          role="menuitemcheckbox"
          checked={marks?.superscript ?? false}
          onSelect={run((e) => e.chain().focus().toggleSuperscript().run())}
        >
          {t("editor.superscript")}
        </MenuItem>
        <MenuItem role="menuitemcheckbox" checked={marks?.code ?? false} onSelect={run((e) => e.chain().focus().toggleCode().run())}>
          {t("editor.code")}
        </MenuItem>
        <MenuItem onSelect={run(clearFormatting)}>{t("editor.clearFormatting")}</MenuItem>
      </Popover>
      <ToolbarSeparator />

      <ToolbarButton
        label={t("editor.bulletList")}
        pressed={state?.lists.bulletList ?? false}
        disabled={off}
        onPress={run((e) => e.chain().focus().toggleBulletList().run())}
      >
        <BulletListIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.orderedList")}
        pressed={state?.lists.orderedList ?? false}
        disabled={off}
        onPress={run((e) => e.chain().focus().toggleOrderedList().run())}
      >
        <OrderedListIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.taskList")}
        pressed={state?.lists.taskList ?? false}
        disabled={off}
        onPress={run((e) => e.chain().focus().toggleTaskList().run())}
      >
        <TaskListIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.outdent")} disabled={off || !state.canOutdent} onPress={run((e) => shiftIndent(e, -1))}>
        <OutdentIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.indent")} disabled={off || !state.canIndent} onPress={run((e) => shiftIndent(e, 1))}>
        <IndentIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.alignLeft")} pressed={align === null || align === "left"} disabled={off} onPress={run((e) => setAlignment(e, "left"))}>
        <AlignLeftIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.alignRight")} pressed={align === "right"} disabled={off} onPress={run((e) => setAlignment(e, "right"))}>
        <AlignRightIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.alignCentre")} pressed={align === "center"} disabled={off} onPress={run((e) => setAlignment(e, "center"))}>
        <AlignCentreIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.infoPanel")} pressed={state?.infoPanel ?? false} disabled={off} onPress={run(toggleInfoPanel)}>
        <InfoPanelIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      {/* `🖼` opens the attachment picker and uploads (RD-058). */}
      {onChooseFiles ? (
        <ToolbarButton label={t("editor.files")} disabled={off} onPress={onChooseFiles} testId="toolbar-files">
          <ImageIcon />
        </ToolbarButton>
      ) : (
        <ToolbarSlot label={t("editor.files")} testId="slot-files">
          <ImageIcon />
        </ToolbarSlot>
      )}
      <ToolbarButton label={t("editor.link")} pressed={state?.link ?? false} disabled={off} onPress={onOpenLink}>
        <LinkIcon />
      </ToolbarButton>
      <Popover kind="dialog" label={t("editor.table")} icon={<TableIcon />} disabled={off} roving keepEditorFocus>
        <TableSizeGrid onPick={({ rows, cols }) => run((e) => insertTable(e, rows, cols))()} />
      </Popover>
      <Popover kind="dialog" label={t("editor.emoji")} icon={<EmojiIcon />} disabled={off} roving keepEditorFocus showChevron={false}>
        <EmojiGrid onPick={(emoji) => run((e) => insertEmoji(e, emoji))()} />
      </Popover>
      <ToolbarSeparator />

      {/* The `+ ▾` Insert More Content menu (10 §5.5). */}
      {insertMenu ?? (
        <ToolbarSlot label={t("editor.insertMore")} testId="slot-insert-more">
          <PlusIcon />
          <ChevronDown size={12} />
        </ToolbarSlot>
      )}
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.undo")} disabled={off || !state.canUndo} onPress={run((e) => e.chain().focus().undo().run())}>
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.redo")} disabled={off || !state.canRedo} onPress={run((e) => e.chain().focus().redo().run())}>
        <RedoIcon />
      </ToolbarButton>

      <span className="ml-auto" />
      {/* `🔍` find and replace, `?` keyboard shortcuts (RD-057). Neither changes the page, so
          both work while the page is read-only. */}
      {onToggleFind ? (
        <ToolbarButton label={t("editor.find")} pressed={findOpen} disabled={editor === null} onPress={onToggleFind} testId="toolbar-find">
          <SearchIcon size={18} />
        </ToolbarButton>
      ) : (
        <ToolbarSlot label={t("editor.find")} testId="slot-find">
          <SearchIcon size={18} />
        </ToolbarSlot>
      )}
      {onOpenShortcuts ? (
        <ToolbarButton label={t("editor.help")} onPress={onOpenShortcuts} testId="toolbar-help">
          <HelpIcon size={18} />
        </ToolbarButton>
      ) : (
        <ToolbarSlot label={t("editor.help")} testId="slot-help">
          <HelpIcon size={18} />
        </ToolbarSlot>
      )}
    </Toolbar>
  );
}

export interface TableToolbarProps {
  readonly editor: Editor;
  readonly table: TableToolbarState;
  readonly readOnly: boolean;
}

// spec: docs/specs/10-ui-reference.md section 5.1 (toolbar row 2, only in a table); RD-057, RD-069
export function TableToolbar({ editor, table, readOnly }: TableToolbarProps) {
  const run = (command: (editor: Editor) => unknown) => () => {
    if (!readOnly) command(editor);
  };
  const can = table.can;
  const modeLabel = (mode: "responsive" | "fixed") => t(mode === "fixed" ? "editor.table.fixed" : "editor.table.responsive");

  return (
    <Toolbar label={t("editor.tableToolbar")} testId="table-toolbar">
      <Popover
        kind="menu"
        label={t("editor.table.widthMode")}
        valueText={modeLabel(table.widthMode)}
        disabled={readOnly}
        roving
        keepEditorFocus
        triggerClassName="inline-flex h-8 items-center gap-1 rounded px-2 text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-expanded:bg-slate-200"
      >
        {(["responsive", "fixed"] as const).map((mode) => (
          <MenuItem key={mode} role="menuitemradio" checked={table.widthMode === mode} onSelect={run((e) => setTableWidthMode(e, mode))}>
            {modeLabel(mode)}
          </MenuItem>
        ))}
      </Popover>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.table.rowAbove")} disabled={readOnly || !can.addRowBefore} onPress={run((e) => e.chain().focus().addRowBefore().run())}>
        <RowAboveIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.table.rowBelow")} disabled={readOnly || !can.addRowAfter} onPress={run((e) => e.chain().focus().addRowAfter().run())}>
        <RowBelowIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.table.deleteRow")} disabled={readOnly || !can.deleteRow} onPress={run((e) => e.chain().focus().deleteRow().run())}>
        <DeleteRowIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton
        label={t("editor.table.columnBefore")}
        disabled={readOnly || !can.addColumnBefore}
        onPress={run((e) => e.chain().focus().addColumnBefore().run())}
      >
        <ColumnBeforeIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.table.columnAfter")}
        disabled={readOnly || !can.addColumnAfter}
        onPress={run((e) => e.chain().focus().addColumnAfter().run())}
      >
        <ColumnAfterIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.table.deleteColumn")}
        disabled={readOnly || !can.deleteColumn}
        onPress={run((e) => e.chain().focus().deleteColumn().run())}
      >
        <DeleteColumnIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.table.merge")} disabled={readOnly || !can.mergeCells} onPress={run((e) => e.chain().focus().mergeCells().run())}>
        <MergeCellsIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.table.split")} disabled={readOnly || !can.splitCell} onPress={run((e) => e.chain().focus().splitCell().run())}>
        <SplitCellIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <ToolbarButton
        label={t("editor.table.headerRow")}
        pressed={table.headerRow}
        disabled={readOnly || !can.toggleHeaderRow}
        onPress={run((e) => e.chain().focus().toggleHeaderRow().run())}
      >
        <HeaderRowIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.table.headerColumn")}
        pressed={table.headerColumn}
        disabled={readOnly || !can.toggleHeaderColumn}
        onPress={run((e) => e.chain().focus().toggleHeaderColumn().run())}
      >
        <HeaderColumnIcon />
      </ToolbarButton>
      <ToolbarButton label={t("editor.table.numbered")} pressed={table.numbered} disabled={readOnly} onPress={run(toggleNumberedColumn)}>
        <NumberedColumnIcon />
      </ToolbarButton>
      <ToolbarSeparator />

      <Popover kind="menu" label={t("editor.table.fill")} icon={<FillIcon colour={table.background} />} disabled={readOnly} roving keepEditorFocus>
        <MenuItem role="menuitemradio" checked={table.background === null} onSelect={run((e) => setCellBackground(e, null))}>
          <Swatch colour={null} />
          {t("editor.table.noFill")}
        </MenuItem>
        {CELL_FILLS.map((swatch) => (
          <MenuItem key={swatch.hex} role="menuitemradio" checked={table.background === swatch.hex} onSelect={run((e) => setCellBackground(e, swatch.hex))}>
            <Swatch colour={swatch.hex} />
            {t(swatch.copy)}
          </MenuItem>
        ))}
      </Popover>
      <ToolbarSeparator />

      <ToolbarButton label={t("editor.table.delete")} disabled={readOnly || !can.deleteTable} onPress={run((e) => e.chain().focus().deleteTable().run())}>
        <DeleteTableIcon />
      </ToolbarButton>
    </Toolbar>
  );
}
