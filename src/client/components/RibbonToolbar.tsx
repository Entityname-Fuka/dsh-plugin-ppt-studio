import React, { useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Bold,
  ChevronDown,
  ChevronUp,
  Circle,
  Eraser,
  Italic,
  Layers,
  Minus,
  MonitorPlay,
  Paintbrush,
  Palette,
  PenTool,
  PieChart,
  Play,
  PlusCircle,
  Printer,
  Redo2,
  RectangleHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Table2,
  Trash2,
  TrendingUp,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  BUILTIN_ANIM_TYPES,
  BUILTIN_THEMES,
  RIBBON_TABS,
  type RibbonTabName,
} from '../../core/constants';
import type {
  ChartType,
  PresentationDeck,
  ShapeKind,
  SlideElement,
  SlideTransitionType,
} from '../../core/types';

export interface RibbonToolbarProps {
  deck: PresentationDeck;
  activePageIndex: number;
  selectedElements: SlideElement[];
  canUndo: boolean;
  canRedo: boolean;
  isMarqueeMode: boolean;
  showOutline: boolean;
  showNotes: boolean;
  zoomPercent: number;
  onUndo: () => void;
  onRedo: () => void;
  onInsertText: () => void;
  onInsertShape: (shapeType: ShapeKind) => void;
  onInsertLine: () => void;
  onInsertTable: () => void;
  onInsertChart: (chartType: ChartType) => void;
  onUpdateTextStyle: (patch: {
    font_size?: number;
    font_color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    align?: 'left' | 'center' | 'right';
  }) => void;
  onUpdateShapeStyle: (patch: {
    fill_color?: string;
    border_color?: string;
  }) => void;
  onClearFormatting: () => void;
  onCopyStyle: () => void;
  onReorderShape: (op: 0 | 1 | 2 | 3) => void;
  onDeleteSelected: () => void;
  onApplyTheme: (themeId: string) => void;
  onSetPageBackground: (hex: string) => void;
  onSetTransition: (type: SlideTransitionType) => void;
  onAddAnimation: (animType: string) => void;
  onRemoveAnimation: () => void;
  onSetAspectRatio: (ratio: 1 | 2) => void;
  onFindReplace: (find: string, replace: string) => number;
  onStartSlideshow: (fromStart?: boolean) => void;
  onToggleSlideSorter: () => void;
  onToggleMarqueeMode: () => void;
  onToggleOutline: () => void;
  onToggleNotes: () => void;
  onChangeZoom: (zoom: number) => void;
  onToast: (msg: string) => void;
}

type PopoverKey = 'insert' | 'font' | 'paragraph' | 'draw' | 'pageSetup' | 'search' | null;

const SWATCHES = ['38E8D4', '846BFF', '2563EB', 'F59E0B', '10B981', 'EF4444', 'F1F5F9', '11182B'];

export const RibbonToolbar: React.FC<RibbonToolbarProps> = ({
  deck,
  activePageIndex,
  selectedElements,
  canUndo,
  canRedo,
  isMarqueeMode,
  showOutline,
  showNotes,
  zoomPercent,
  onUndo,
  onRedo,
  onInsertText,
  onInsertShape,
  onInsertLine,
  onInsertTable,
  onInsertChart,
  onUpdateTextStyle,
  onUpdateShapeStyle,
  onClearFormatting,
  onCopyStyle,
  onReorderShape,
  onDeleteSelected,
  onApplyTheme,
  onSetPageBackground,
  onSetTransition,
  onAddAnimation,
  onRemoveAnimation,
  onSetAspectRatio,
  onFindReplace,
  onStartSlideshow,
  onToggleSlideSorter,
  onToggleMarqueeMode,
  onToggleOutline,
  onToggleNotes,
  onChangeZoom,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<RibbonTabName>('开始');
  const [collapsed, setCollapsed] = useState(false);
  const [openMenu, setOpenMenu] = useState<PopoverKey>(null);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const primarySel = selectedElements[0];
  const currentSlide = deck.slides[activePageIndex];

  const toggleMenu = (key: PopoverKey) => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  return (
    <div className="ppt-ribbon">
      <div className="ppt-ribbon-tabs" role="tablist" aria-label="PPT Ribbon 选项卡">
        {RIBBON_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`ppt-ribbon-tab ${activeTab === tab ? 'is-active' : ''}`}
            onClick={() => {
              setActiveTab(tab);
              setCollapsed(false);
              setOpenMenu(null);
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {!collapsed && (
        <div className="ppt-ribbon-strip">
          {activeTab === '开始' && (
            <div className="ppt-ribbon-commands">
              {/* 左侧 2x2 快捷操作（撤销 / 重做 / 格式刷 / 清除格式） */}
              <div className="ppt-ribbon-grid2x2">
                <button
                  type="button"
                  className="dsh-icon-btn"
                  style={{ width: 22, height: 22 }}
                  disabled={!canUndo}
                  title="撤销 (Ctrl+Z)"
                  onClick={onUndo}
                >
                  <Undo2 size={13} />
                </button>
                <button
                  type="button"
                  className="dsh-icon-btn"
                  style={{ width: 22, height: 22 }}
                  disabled={!canRedo}
                  title="重做 (Ctrl+Y)"
                  onClick={onRedo}
                >
                  <Redo2 size={13} />
                </button>
                <button
                  type="button"
                  className="dsh-icon-btn"
                  style={{ width: 22, height: 22 }}
                  title="格式刷（复制/粘贴样式）"
                  onClick={onCopyStyle}
                >
                  <Paintbrush size={12} />
                </button>
                <button
                  type="button"
                  className="dsh-icon-btn"
                  style={{ width: 22, height: 22 }}
                  disabled={selectedElements.length === 0}
                  title="清除选中元素格式"
                  onClick={onClearFormatting}
                >
                  <Eraser size={12} />
                </button>
              </div>

              <div className="ppt-ribbon-divider" />

              {/* 插入 ▾ */}
              <div className="ppt-popover-anchor">
                <button
                  type="button"
                  className="ppt-ribbon-tool-btn"
                  onClick={() => toggleMenu('insert')}
                >
                  <PlusCircle size={17} strokeWidth={1.7} />
                  <span className="ppt-ribbon-tool-label">
                    插入 <ChevronDown size={10} />
                  </span>
                </button>
                {openMenu === 'insert' && (
                  <div className="ppt-dropdown-menu">
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onInsertText();
                      }}
                    >
                      <span>插入文本框</span>
                      <Type size={13} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onInsertShape('roundRect');
                      }}
                    >
                      <span>圆角卡片</span>
                      <RectangleHorizontal size={13} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onInsertShape('ellipse');
                      }}
                    >
                      <span>圆形 / 椭圆</span>
                      <Circle size={13} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onInsertTable();
                      }}
                    >
                      <span>数据表格 (3×3)</span>
                      <Table2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        onInsertChart('bar');
                      }}
                    >
                      <span>柱状图</span>
                      <BarChart3 size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* 字体 Aa ▾ */}
              <div className="ppt-popover-anchor">
                <button
                  type="button"
                  className="ppt-ribbon-tool-btn"
                  onClick={() => toggleMenu('font')}
                >
                  <span style={{ fontSize: 15, fontWeight: 600, lineHeight: '17px' }}>
                    Aa
                  </span>
                  <span className="ppt-ribbon-tool-label">
                    字体 <ChevronDown size={10} />
                  </span>
                </button>
                {openMenu === 'font' && (
                  <div className="ppt-dropdown-menu" style={{ minWidth: 220, padding: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      <button
                        type="button"
                        className="ppt-ribbon-inline-btn"
                        onClick={() =>
                          onUpdateTextStyle({
                            font_size: (primarySel?.text?.fontSize ?? 14) + 2,
                          })
                        }
                      >
                        A+
                      </button>
                      <button
                        type="button"
                        className="ppt-ribbon-inline-btn"
                        onClick={() =>
                          onUpdateTextStyle({
                            font_size: Math.max(8, (primarySel?.text?.fontSize ?? 14) - 2),
                          })
                        }
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        className={`ppt-ribbon-inline-btn ${primarySel?.text?.bold ? 'is-active' : ''}`}
                        onClick={() =>
                          onUpdateTextStyle({ bold: !primarySel?.text?.bold })
                        }
                      >
                        <Bold size={12} />
                      </button>
                      <button
                        type="button"
                        className={`ppt-ribbon-inline-btn ${primarySel?.text?.italic ? 'is-active' : ''}`}
                        onClick={() =>
                          onUpdateTextStyle({ italic: !primarySel?.text?.italic })
                        }
                      >
                        <Italic size={12} />
                      </button>
                      <button
                        type="button"
                        className={`ppt-ribbon-inline-btn ${primarySel?.text?.underline ? 'is-active' : ''}`}
                        onClick={() =>
                          onUpdateTextStyle({ underline: !primarySel?.text?.underline })
                        }
                      >
                        <Underline size={12} />
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                      文字颜色
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          title={`#${hex}`}
                          onClick={() => onUpdateTextStyle({ font_color: hex })}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid #cbd5e1',
                            background: `#${hex}`,
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 段落 ▾ */}
              <div className="ppt-popover-anchor">
                <button
                  type="button"
                  className="ppt-ribbon-tool-btn"
                  onClick={() => toggleMenu('paragraph')}
                >
                  <AlignLeft size={16} strokeWidth={1.7} />
                  <span className="ppt-ribbon-tool-label">
                    段落 <ChevronDown size={10} />
                  </span>
                </button>
                {openMenu === 'paragraph' && (
                  <div className="ppt-dropdown-menu" style={{ minWidth: 160, padding: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="ppt-ribbon-inline-btn"
                        onClick={() => {
                          onUpdateTextStyle({ align: 'left' });
                          setOpenMenu(null);
                        }}
                      >
                        <AlignLeft size={13} />
                      </button>
                      <button
                        type="button"
                        className="ppt-ribbon-inline-btn"
                        onClick={() => {
                          onUpdateTextStyle({ align: 'center' });
                          setOpenMenu(null);
                        }}
                      >
                        <AlignCenter size={13} />
                      </button>
                      <button
                        type="button"
                        className="ppt-ribbon-inline-btn"
                        onClick={() => {
                          onUpdateTextStyle({ align: 'right' });
                          setOpenMenu(null);
                        }}
                      >
                        <AlignRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 绘图 ▾ */}
              <div className="ppt-popover-anchor">
                <button
                  type="button"
                  className="ppt-ribbon-tool-btn"
                  onClick={() => toggleMenu('draw')}
                >
                  <PenTool size={16} strokeWidth={1.7} />
                  <span className="ppt-ribbon-tool-label">
                    绘图 <ChevronDown size={10} />
                  </span>
                </button>
                {openMenu === 'draw' && (
                  <div className="ppt-dropdown-menu" style={{ minWidth: 210, padding: 8 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                      形状填充色
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                      {SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => onUpdateShapeStyle({ fill_color: hex })}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid #cbd5e1',
                            background: `#${hex}`,
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        onReorderShape(0);
                        setOpenMenu(null);
                      }}
                    >
                      <span>置于顶层</span>
                      <Layers size={12} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        onReorderShape(1);
                        setOpenMenu(null);
                      }}
                    >
                      <span>置于底层</span>
                      <Layers size={12} />
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      style={{ color: '#dc2626' }}
                      onClick={() => {
                        onDeleteSelected();
                        setOpenMenu(null);
                      }}
                    >
                      <span>删除选中元素</span>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* 动画 */}
              <button
                type="button"
                className="ppt-ribbon-tool-btn"
                title="为选中元素添加淡入动画"
                onClick={() => {
                  if (selectedElements.length === 0) {
                    setActiveTab('动画');
                  } else {
                    onAddAnimation('fadeIn');
                  }
                }}
              >
                <Sparkles size={16} strokeWidth={1.7} />
                <span className="ppt-ribbon-tool-label">动画</span>
              </button>

              {/* 页面设置 ▾ */}
              <div className="ppt-popover-anchor">
                <button
                  type="button"
                  className="ppt-ribbon-tool-btn"
                  onClick={() => toggleMenu('pageSetup')}
                >
                  <SlidersHorizontal size={16} strokeWidth={1.7} />
                  <span className="ppt-ribbon-tool-label">
                    页面设置 <ChevronDown size={10} />
                  </span>
                </button>
                {openMenu === 'pageSetup' && (
                  <div className="ppt-dropdown-menu" style={{ minWidth: 196 }}>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        onSetAspectRatio(2);
                        setOpenMenu(null);
                      }}
                    >
                      <span>宽屏 16:9 (960×540pt)</span>
                      {deck.aspect_ratio === 2 ? '✓' : ''}
                    </button>
                    <button
                      type="button"
                      className="ppt-dropdown-item"
                      onClick={() => {
                        onSetAspectRatio(1);
                        setOpenMenu(null);
                      }}
                    >
                      <span>标准 4:3 (720×540pt)</span>
                      {deck.aspect_ratio === 1 ? '✓' : ''}
                    </button>
                    <div
                      style={{
                        borderTop: '1px solid #f0f2f5',
                        padding: '6px 8px 4px',
                        fontSize: 11,
                        color: '#6b7280',
                      }}
                    >
                      当前页背景色
                    </div>
                    <div style={{ display: 'flex', gap: 5, padding: '2px 8px 6px' }}>
                      {['090D18', '11182B', '0F172A', 'FFFFFF', 'FAF8F5'].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => {
                            onSetPageBackground(hex);
                            setOpenMenu(null);
                          }}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid #cbd5e1',
                            background: `#${hex}`,
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 打印 */}
              <button
                type="button"
                className="ppt-ribbon-tool-btn"
                title="打印演示文稿"
                onClick={() => {
                  onToast('正在准备打印视图...');
                  window.print?.();
                }}
              >
                <Printer size={16} strokeWidth={1.7} />
                <span className="ppt-ribbon-tool-label">打印</span>
              </button>
            </div>
          )}

          {activeTab === '插入' && (
            <div className="ppt-ribbon-commands">
              <button type="button" className="ppt-ribbon-inline-btn" onClick={onInsertText}>
                <Type size={13} /> 文本框
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertShape('rect')}
              >
                <Square size={13} /> 矩形
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertShape('roundRect')}
              >
                <RectangleHorizontal size={13} /> 圆角卡片
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertShape('ellipse')}
              >
                <Circle size={13} /> 圆形
              </button>
              <button type="button" className="ppt-ribbon-inline-btn" onClick={onInsertLine}>
                <Minus size={13} /> 箭头线
              </button>
              <button type="button" className="ppt-ribbon-inline-btn" onClick={onInsertTable}>
                <Table2 size={13} /> 表格
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertChart('bar')}
              >
                <BarChart3 size={13} /> 柱状图
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertChart('line')}
              >
                <TrendingUp size={13} /> 折线图
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onInsertChart('pie')}
              >
                <PieChart size={13} /> 饼图
              </button>
            </div>
          )}

          {activeTab === '美化' && (
            <div className="ppt-ribbon-commands">
              <span style={{ fontSize: 11.5, color: '#6b7280', marginRight: 4 }}>
                <Palette size={13} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                一键切换主题：
              </span>
              {BUILTIN_THEMES.map((theme) => (
                <button
                  key={theme.theme_id}
                  type="button"
                  className={`ppt-ribbon-inline-btn ${
                    deck.theme_id === theme.theme_id ? 'is-active' : ''
                  }`}
                  onClick={() => onApplyTheme(theme.theme_id)}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: `#${theme.background}`,
                      border: `1.5px solid #${theme.primary}`,
                    }}
                  />
                  <span>{theme.name.split('（')[0]}</span>
                </button>
              ))}
            </div>
          )}

          {activeTab === '切换' && (
            <div className="ppt-ribbon-commands">
              <span style={{ fontSize: 11.5, color: '#6b7280', marginRight: 4 }}>
                当前页切换动画：
              </span>
              {(
                [
                  ['none', '无切换'],
                  ['fade', '淡出淡入'],
                  ['push', '平滑推入'],
                  ['wipe', '擦除'],
                  ['zoom', '缩放'],
                ] as Array<[SlideTransitionType, string]>
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  className={`ppt-ribbon-inline-btn ${
                    (currentSlide?.transition?.type || 'none') === type ? 'is-active' : ''
                  }`}
                  onClick={() => onSetTransition(type)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {activeTab === '动画' && (
            <div className="ppt-ribbon-commands">
              {BUILTIN_ANIM_TYPES.slice(0, 6).map((anim) => (
                <button
                  key={anim.anim_type}
                  type="button"
                  className="ppt-ribbon-inline-btn"
                  onClick={() => onAddAnimation(anim.anim_type)}
                >
                  <Sparkles size={12} /> {anim.label}
                </button>
              ))}
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={onRemoveAnimation}
              >
                移除动画
              </button>
            </div>
          )}

          {activeTab === '放映' && (
            <div className="ppt-ribbon-commands">
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onStartSlideshow(true)}
              >
                <Play size={12} /> 从头开始放映
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={() => onStartSlideshow(false)}
              >
                <MonitorPlay size={12} /> 从当前页放映
              </button>
              <button
                type="button"
                className="ppt-ribbon-inline-btn"
                onClick={onToggleSlideSorter}
              >
                幻灯片浏览视图
              </button>
            </div>
          )}

          {activeTab === '视图' && (
            <div className="ppt-ribbon-commands">
              <button
                type="button"
                className={`ppt-ribbon-inline-btn ${isMarqueeMode ? 'is-active' : ''}`}
                onClick={onToggleMarqueeMode}
              >
                自由框选模式
              </button>
              <button
                type="button"
                className={`ppt-ribbon-inline-btn ${showOutline ? 'is-active' : ''}`}
                onClick={onToggleOutline}
              >
                左侧缩略图栏
              </button>
              <button
                type="button"
                className={`ppt-ribbon-inline-btn ${showNotes ? 'is-active' : ''}`}
                onClick={onToggleNotes}
              >
                演讲者备注
              </button>
              {[39, 50, 75, 100].map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`ppt-ribbon-inline-btn ${zoomPercent === z ? 'is-active' : ''}`}
                  onClick={() => onChangeZoom(z)}
                >
                  {z}%
                </button>
              ))}
            </div>
          )}

          {/* 右侧查找与折叠按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <div className="ppt-popover-anchor">
              <button
                type="button"
                className="dsh-icon-btn"
                title="查找与替换文本"
                onClick={() => toggleMenu('search')}
              >
                <Search size={14} />
              </button>
              {openMenu === 'search' && (
                <div className="ppt-dropdown-menu align-right" style={{ minWidth: 230, padding: 10 }}>
                  <input
                    className="ppt-hud-ai-input"
                    style={{ width: '100%', marginBottom: 6 }}
                    placeholder="查找内容..."
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                  />
                  <input
                    className="ppt-hud-ai-input"
                    style={{ width: '100%', marginBottom: 8 }}
                    placeholder="替换为..."
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ppt-hud-btn primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => {
                      const count = onFindReplace(findText, replaceText);
                      onToast(`已替换 ${count} 处匹配文本`);
                      setOpenMenu(null);
                    }}
                  >
                    全部替换
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="dsh-icon-btn"
              title="折叠功能区"
              onClick={() => setCollapsed(true)}
            >
              <ChevronUp size={14} />
            </button>
          </div>
        </div>
      )}

      {collapsed && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '2px 10px',
            borderTop: '1px solid #f2f4f7',
          }}
        >
          <button
            type="button"
            className="dsh-icon-btn"
            style={{ width: 22, height: 20 }}
            title="展开功能区"
            onClick={() => setCollapsed(false)}
          >
            <ChevronDown size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
