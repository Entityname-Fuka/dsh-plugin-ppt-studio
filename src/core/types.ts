export interface BoundsPt {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SlideElementType =
  | 'text'
  | 'shape'
  | 'line'
  | 'table'
  | 'chart'
  | 'image'
  | 'svg'
  | 'group';

export type ElementRole =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'kpi'
  | 'chart'
  | 'table'
  | 'badge'
  | 'footer'
  | 'decoration'
  | 'callout';

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'rightArrow'
  | 'leftArrow'
  | 'diamond';

export type DashStyle = 'solid' | 'dash' | 'dot';

export type LineType = 'line' | 'arrow' | 'doubleArrow';

export type ChartType = 'bar' | 'line' | 'pie' | 'area';

export type SlideTransitionType = 'none' | 'fade' | 'push' | 'wipe' | 'zoom';

export interface FillStyle {
  /** 6-char uppercase RRGGBB without # or 'none' */
  color: string;
  /** 0 = opaque, 100 = fully transparent */
  alpha?: number;
}

export interface BorderStyle {
  /** 6-char uppercase RRGGBB without # or 'none' */
  color: string;
  width?: number;
  dash?: DashStyle;
  alpha?: number;
}

export interface LineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineType: LineType;
  color: string;
  width: number;
  dash?: DashStyle;
}

export interface TextSpan {
  text: string;
  fontName?: string;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface TextProps {
  content: string;
  fontName?: string;
  fontSize: number;
  fontColor: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  spans?: TextSpan[];
}

export interface TableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
  mergedInto?: { row: number; col: number };
  bgColor?: string;
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  borderColor?: string;
}

export interface TableProps {
  rows: number;
  cols: number;
  cells: TableCell[][];
  headerBg?: string;
  zebraBg?: string;
  borderColor?: string;
  colWidths?: number[];
  rowHeights?: number[];
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface ChartProps {
  chartType: ChartType;
  title?: string;
  categories: string[];
  series: ChartSeries[];
  showLegend?: boolean;
  showGridlines?: boolean;
  showDataLabels?: boolean;
  yAxisMax?: number;
  yAxisStep?: number;
  unit?: string;
}

export interface SvgProps {
  viewBox: string;
  markup: string;
}

export interface ImageProps {
  src: string;
  alt?: string;
  objectFit?: 'cover' | 'contain';
}

export interface SlideAnimation {
  anim_id: string;
  anim_type: string;
  anim_subtype?: string;
  category: 'entrance' | 'emphasis' | 'exit' | 'motion';
  trigger: 'onClick' | 'withPrevious' | 'afterPrevious';
  durationMs: number;
  delayMs?: number;
}

export interface SlideElement {
  shape_id: string;
  type: SlideElementType;
  name?: string;
  role?: ElementRole | string;
  bounds: BoundsPt;
  rotation?: number;
  zIndex: number;
  groupId?: string;
  shapeType?: ShapeKind;
  fill?: FillStyle;
  border?: BorderStyle;
  cornerRadius?: number;
  line?: LineProps;
  text?: TextProps;
  table?: TableProps;
  chart?: ChartProps;
  svg?: SvgProps;
  image?: ImageProps;
  animations?: SlideAnimation[];
}

export interface SlideBackground {
  color: string;
  gradient?: string;
}

export interface SlideTransition {
  type: SlideTransitionType;
  durationMs: number;
}

export interface SlidePage {
  slide_id: string;
  title: string;
  background: SlideBackground;
  transition?: SlideTransition;
  notes: string;
  elements: SlideElement[];
}

export interface SlideSection {
  section_id: string;
  title: string;
  start_page_index: number;
}

export interface SlideComment {
  comment_id: string;
  page_index: number;
  shape_id?: string;
  author: string;
  text: string;
  created_at: number;
  resolved?: boolean;
}

export interface AiEditRecord {
  edit_id: string;
  version: number;
  timestamp: number;
  tool_name: string;
  summary: string;
  page_index?: number;
  shape_ids?: string[];
  selection_range_id?: string;
  before_snapshot: string;
  reverted?: boolean;
}

export interface ThemeDefinition {
  theme_id: string;
  name: string;
  description: string;
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  fontFamily: string;
}

export interface PresentationDeck {
  file_id: string;
  file_name: string;
  file_path: string;
  aspect_ratio: 1 | 2;
  width_pt: number;
  height_pt: number;
  theme_id: string;
  design_md?: string;
  version: number;
  updated_at: number;
  slides: SlidePage[];
  sections: SlideSection[];
  comments: SlideComment[];
  ai_edits: AiEditRecord[];
}

export type JsxNodeTag =
  | 'Slide'
  | 'Box'
  | 'Text'
  | 'Chart'
  | 'Table'
  | 'SVG'
  | 'Image'
  | 'Line';

export interface JsxPageNode {
  tag: JsxNodeTag;
  props?: Record<string, unknown>;
  children?: Array<JsxPageNode | string>;
}

export interface DeckEngineOptions {
  requireDesignMd?: boolean;
  maxHistory?: number;
}

export interface ManualHistoryEntry {
  id: string;
  label: string;
  page_index?: number;
  timestamp: number;
}

export type SelectionMode =
  | 'element'
  | 'multi-element'
  | 'free-marquee'
  | 'whole-slide'
  | 'table-cells'
  | 'chart-series';

export interface IndexedElementHit {
  shape_id: string;
  shape_index: number;
  type: SlideElementType;
  role?: string;
  bounds_pt: BoundsPt;
  overlap_ratio: number;
  text_preview?: string;
  style_summary?: {
    fill_color?: string;
    border_color?: string;
    font_size?: number;
    font_color?: string;
  };
  table_cells?: {
    start_row: number;
    start_col: number;
    end_row: number;
    end_col: number;
  };
  chart_summary?: {
    chart_type: string;
    title?: string;
    series_names: string[];
    categories: string[];
  };
}

export interface SlideSelectionPayload {
  rangeId: string;
  text: string;
  description?: string;
  timestamp: number;
  fileId: string;
  title: string;
  page_index: number;
  slide_id: string;
  selection_mode: SelectionMode;
  shape_ids: string[];
  shape_indices: number[];
  bbox_pt: BoundsPt;
  elements: IndexedElementHit[];
  recommended_tools: string[];
  aiPrompt?: string;
  sourceApi?: string;
}

export interface DocumentSelectionEvent {
  sessionId?: string;
  documentResourceUri: string;
  filePath: string;
  fileType: 'pptx';
  consumerSurface: 'main' | 'office';
  sequence: number;
  sequenceEpoch: string;
  selection: SlideSelectionPayload;
}

export type SanitizedSlideSelectionPayload = Omit<
  SlideSelectionPayload,
  'aiPrompt' | 'sourceApi'
>;

export interface ActiveDocumentSelection {
  sessionId?: string;
  documentResourceUri: string;
  filePath: string;
  fileType: 'pptx';
  consumerSurface: 'main' | 'office';
  sequence: number;
  sequenceEpoch: string;
  fileId: string;
  rangeId: string;
  title: string;
  selectionText: string;
  description?: string;
  timestamp: number;
  aiPrompt?: string;
  selectionPayload: SanitizedSlideSelectionPayload;
}

export interface DocumentSelectionContextBlockMeta {
  mentionType: 'tencentDocsSelection';
  type: 'document-selection';
  displayAsPhrase: true;
  displayAsContext: false;
  documentResourceUri: string;
  filePath: string;
  fileType: 'pptx';
  fileId: string;
  rangeId: string;
  sequence: number;
  sequenceEpoch: string;
  selectionPayload: SanitizedSlideSelectionPayload;
  aiPrompt?: string;
  selectionPairId?: string;
  selectionAutoPrompt?: boolean;
}

export interface DocumentSelectionContextBlock {
  type: 'resource_link';
  name: string;
  uri: string;
  title: string;
  _meta: DocumentSelectionContextBlockMeta;
}

export interface RegionQueryResult {
  page_index: number;
  slide_id: string;
  bbox_pt: BoundsPt;
  selection_mode: SelectionMode;
  elements: IndexedElementHit[];
  recommended_tools: string[];
  text_summary: string;
}

export interface AiEditResult {
  success: boolean;
  version: number;
  edit_id?: string;
  summary: string;
  tool_calls: Array<{ tool: string; args: Record<string, unknown> }>;
  page_index: number;
  affected_shape_ids: string[];
  deck: PresentationDeck;
}
