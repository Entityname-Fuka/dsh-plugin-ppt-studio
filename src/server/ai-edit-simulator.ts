import {
  DeckEngine,
  normalizeColor,
  querySlideRegion,
} from '../core/index';
import type {
  AiEditResult,
  ChartType,
  IndexedElementHit,
  SlideSelectionPayload,
} from '../core/index';
import { DeckRegistry, DshToolDefinition } from './dsh-compat';
import { createSlideTools } from './slide-tools';

const COLOR_KEYWORD_MAP: Array<[RegExp, string, string]> = [
  [/荧光青|青色|青绿|cyan/i, '38E8D4', '荧光青 (#38E8D4)'],
  [/数字紫|紫色|紫罗兰|purple/i, '846BFF', '数字紫 (#846BFF)'],
  [/琥珀|金黄|金色|橙色|amber|orange/i, 'F59E0B', '琥珀橙 (#F59E0B)'],
  [/科技蓝|深蓝|蓝色|blue/i, '2563EB', '科技蓝 (#2563EB)'],
  [/天蓝|浅蓝|sky/i, '38BDF8', '天蓝 (#38BDF8)'],
  [/翠绿|绿色|绿|green/i, '10B981', '翡翠绿 (#10B981)'],
  [/珊瑚红|红色|红|red/i, 'EF4444', '珊瑚红 (#EF4444)'],
  [/粉色|玫红|pink/i, 'EC4899', '玫粉 (#EC4899)'],
  [/白色|纯白|white/i, 'FFFFFF', '纯白 (#FFFFFF)'],
  [/深海蓝|深黑|深色|dark/i, '090D18', '深海蓝 (#090D18)'],
  [/浅灰|灰白|gray|grey/i, '94A3B8', '银灰 (#94A3B8)'],
];

function extractColorFromInstruction(
  instruction: string
): { hex: string; label: string } | null {
  const hexMatch = instruction.match(/#([0-9a-fA-F]{6})\b/);
  if (hexMatch) {
    const hex = normalizeColor(hexMatch[1]);
    return { hex, label: `#${hex}` };
  }
  const bareHexMatch = instruction.match(/\b([0-9a-fA-F]{6})\b/);
  if (bareHexMatch && /[a-fA-F]/.test(bareHexMatch[1])) {
    const hex = normalizeColor(bareHexMatch[1]);
    return { hex, label: `#${hex}` };
  }
  for (const [re, hex, label] of COLOR_KEYWORD_MAP) {
    if (re.test(instruction)) {
      return { hex, label };
    }
  }
  return null;
}

function extractReplacementText(instruction: string): string | null {
  const quoteMatch = instruction.match(/[“"「『]([^”"」』]+)[”"」』]/);
  if (quoteMatch && quoteMatch[1].trim()) {
    return quoteMatch[1].trim();
  }
  const arrowMatch = instruction.match(
    /(?:改为|替换为|修改为|改成|设为|文案为|内容为)\s*[:：]?\s*(.+)$/
  );
  if (arrowMatch && arrowMatch[1].trim()) {
    const candidate = arrowMatch[1].trim().replace(/[。！!]+$/, '');
    if (!/颜色|字号|折线图|柱状图|饼图|面积图/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractChartType(instruction: string): ChartType | null {
  if (/折线图|趋势图|line/i.test(instruction)) return 'line';
  if (/柱状图|条形图|bar/i.test(instruction)) return 'bar';
  if (/饼图|环形图|pie/i.test(instruction)) return 'pie';
  if (/面积图|area/i.test(instruction)) return 'area';
  return null;
}

export interface ExecuteLocalAiEditParams {
  instruction: string;
  selection?: SlideSelectionPayload;
  page_index?: number;
  file_id?: string;
  registry?: DeckRegistry;
  engine?: DeckEngine;
  executeTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
}

export async function executeLocalAiEdit(
  params: ExecuteLocalAiEditParams
): Promise<AiEditResult> {
  const registry = params.registry ?? new DeckRegistry({ loadSampleDeck: false });
  if (params.engine && !registry.hasDeck(params.engine.getDeckRef().file_id)) {
    registry.registerEngine(params.engine);
  }
  const engine =
    params.engine ?? registry.getEngine(params.file_id ?? params.selection?.fileId);
  const deck = engine.getDeckRef();
  const fileId = deck.file_id;
  const pageIndex = params.selection?.page_index ?? params.page_index ?? 0;
  const instruction = params.instruction.trim();

  const toolsMap = new Map<string, DshToolDefinition<any, any>>();
  for (const t of createSlideTools(registry)) {
    toolsMap.set(t.name, t);
  }

  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    const fullArgs = { file_id: fileId, ...args };
    if (params.executeTool) {
      return params.executeTool(name, fullArgs);
    }
    const tool = toolsMap.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(fullArgs);
  };

  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const invoke = async (name: string, args: Record<string, unknown>) => {
    toolCalls.push({ tool: name, args });
    return callTool(name, args);
  };

  // 1. Undo intent
  if (/撤销|回退|还原|undo/i.test(instruction)) {
    const res = (await invoke('slide_undo_ai_edit', {})) as Record<
      string,
      unknown
    >;
    return {
      success: true,
      version: engine.getDeckRef().version,
      summary: `已撤销上一步 AI 修改（${String(res.reverted_summary ?? '')}）`,
      tool_calls: toolCalls,
      page_index: pageIndex,
      affected_shape_ids: [],
      deck: engine.getDeck(),
    };
  }

  // Resolve target elements from selection (0-based indices)
  const slide = engine.getDeckRef().slides[pageIndex];
  if (!slide) {
    throw new RangeError(`page_index ${pageIndex} out of bounds`);
  }

  let hits: IndexedElementHit[] = [];
  if (params.selection) {
    if (params.selection.elements && params.selection.elements.length > 0) {
      hits = params.selection.elements;
    } else if (params.selection.shape_ids?.length) {
      const idSet = new Set(params.selection.shape_ids);
      slide.elements.forEach((el, idx) => {
        if (idSet.has(el.shape_id)) {
          hits.push({
            shape_id: el.shape_id,
            shape_index: idx,
            type: el.type,
            role: el.role,
            bounds_pt: { ...el.bounds },
            overlap_ratio: 1,
            text_preview: el.text?.content,
          });
        }
      });
    } else if (params.selection.bbox_pt) {
      hits = querySlideRegion(slide, pageIndex, params.selection.bbox_pt).elements;
    }
  }

  // Fallback: pick main content element if no explicit selection provided
  if (hits.length === 0 && slide.elements.length > 0) {
    const primaryIdx =
      slide.elements.findIndex(
        (e) => e.type === 'chart' || e.type === 'table' || e.role === 'kpi'
      ) ?? 0;
    const idx = primaryIdx >= 0 ? primaryIdx : 0;
    const el = slide.elements[idx];
    hits = [
      {
        shape_id: el.shape_id,
        shape_index: idx,
        type: el.type,
        role: el.role,
        bounds_pt: { ...el.bounds },
        overlap_ratio: 1,
        text_preview: el.text?.content,
      },
    ];
  }

  const affectedIds = hits.map((h) => h.shape_id);
  const summaries: string[] = [];

  // 2. Speaker notes update
  if (/备注|演讲稿|口播|notes/i.test(instruction)) {
    const textSnippets = slide.elements
      .filter((e) => e.text?.content && e.role !== 'footer')
      .slice(0, 4)
      .map((e) => e.text!.content.replace(/\s+/g, ' ').trim());
    const generatedNotes =
      extractReplacementText(instruction) ??
      `【第 ${pageIndex + 1} 页口播建议】本页围绕「${slide.title}」展开。重点强调：${textSnippets.join('；')}。建议停顿引导听众关注关键数据变化。`;
    await invoke('slide_set_notes_text', {
      page_index: pageIndex,
      notes: generatedNotes,
    });
    summaries.push(`更新第 ${pageIndex + 1} 页演讲者备注`);
  }

  // 3. Delete selected elements
  else if (/删除|移除|去掉|delete|remove/i.test(instruction)) {
    const indices = hits.map((h) => h.shape_index);
    await invoke('slide_remove_shapes', {
      page_index: pageIndex,
      shape_indices: indices,
    });
    summaries.push(`删除第 ${pageIndex + 1} 页选中的 ${indices.length} 个元素`);
  }

  // 4. Chart transformations (type change / data update / color)
  else {
    const chartHit = hits.find((h) => h.type === 'chart');
    const chartType = extractChartType(instruction);
    const colorChoice = extractColorFromInstruction(instruction);

    if (chartHit && chartType) {
      await invoke('slide_change_chart_type', {
        page_index: pageIndex,
        shape_index: chartHit.shape_index,
        chart_type: chartType,
      });
      summaries.push(`将图表 (${chartHit.shape_id}) 切换为 ${chartType} 视图`);
    }

    if (
      chartHit &&
      (/数据|数值|增长|提升|改为\s*\d|调高|调低/.test(instruction) ||
        /\d+%/.test(instruction))
    ) {
      const nums = [...instruction.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) =>
        Number(m[1])
      );
      const liveChart = engine.getChartInfo(pageIndex, chartHit.shape_index);
      const nextSeries = liveChart.series.map((s, idx) => {
        if (nums.length >= liveChart.categories.length && idx === 0) {
          return {
            ...s,
            values: nums.slice(0, liveChart.categories.length),
          };
        }
        if (nums.length === 1 && idx === liveChart.series.length - 1) {
          const updated = [...s.values];
          updated[updated.length - 1] = nums[0];
          return { ...s, values: updated };
        }
        return idx === liveChart.series.length - 1
          ? { ...s, values: s.values.map((v) => Math.min(100, v + 5)) }
          : s;
      });
      await invoke('slide_update_chart_data', {
        page_index: pageIndex,
        shape_index: chartHit.shape_index,
        series: nextSeries,
      });
      summaries.push(`更新图表 (${chartHit.shape_id}) 系列数值`);
    }

    if (chartHit && colorChoice) {
      await invoke('slide_update_chart_series_style', {
        page_index: pageIndex,
        shape_index: chartHit.shape_index,
        series_index: 0,
        color: colorChoice.hex,
      });
      summaries.push(
        `调整图表 (${chartHit.shape_id}) 主系列配色为 ${colorChoice.label}`
      );
    }

    // 5. Font size & typography tweaks
    const textHits = hits.filter((h) => {
      const el = slide.elements[h.shape_index];
      return Boolean(el?.text);
    });

    if (/放大|调大|变大|加大|大一点|缩小|调小|变小|小一点|字号/.test(instruction)) {
      const explicitSizeMatch = instruction.match(/(\d{1,3})\s*(?:pt|px|号)/i);
      for (const h of textHits) {
        const curSize = slide.elements[h.shape_index]?.text?.fontSize ?? 14;
        const nextSize = explicitSizeMatch
          ? Number(explicitSizeMatch[1])
          : /缩小|调小|变小|小一点/.test(instruction)
            ? Math.max(8, curSize - 4)
            : Math.min(96, curSize + 6);
        await invoke('slide_set_text_property', {
          page_index: pageIndex,
          shape_index: h.shape_index,
          font_size: nextSize,
        });
      }
      if (textHits.length > 0) {
        summaries.push(`调整 ${textHits.length} 个文本元素字号`);
      }
    }

    if (/加粗|粗体|bold/i.test(instruction)) {
      for (const h of textHits) {
        await invoke('slide_set_text_property', {
          page_index: pageIndex,
          shape_index: h.shape_index,
          bold: true,
        });
      }
      if (textHits.length > 0) summaries.push('应用加粗强调');
    }

    if (/居中|左对齐|右对齐/.test(instruction)) {
      const align = /居中/.test(instruction)
        ? 'center'
        : /右对齐/.test(instruction)
          ? 'right'
          : 'left';
      for (const h of textHits) {
        await invoke('slide_set_text_property', {
          page_index: pageIndex,
          shape_index: h.shape_index,
          align,
        });
      }
      if (textHits.length > 0) summaries.push(`对齐方式调整为 ${align}`);
    }

    // 6. Color changes on non-chart shapes / text
    if (colorChoice && (!chartHit || hits.length > 1)) {
      const nonChartHits = hits.filter((h) => h.type !== 'chart');
      const isBorder = /边框|描边|border|线/i.test(instruction);
      const isTextOnly = nonChartHits.every((h) => h.type === 'text');

      if (isTextOnly || /字体颜色|文字颜色|字色/.test(instruction)) {
        for (const h of nonChartHits) {
          if (slide.elements[h.shape_index]?.text) {
            await invoke('slide_set_text_property', {
              page_index: pageIndex,
              shape_index: h.shape_index,
              font_color: colorChoice.hex,
            });
          }
        }
        summaries.push(`修改选中文本颜色为 ${colorChoice.label}`);
      } else if (nonChartHits.length > 0) {
        await invoke('slide_set_shape_properties', {
          page_index: pageIndex,
          shape_indices: nonChartHits.map((h) => h.shape_index),
          ...(isBorder
            ? { border_color: colorChoice.hex, border_width: 2 }
            : { fill_color: colorChoice.hex }),
        });
        summaries.push(
          `修改 ${nonChartHits.length} 个元素${isBorder ? '边框' : '填充'}颜色为 ${colorChoice.label}`
        );
      }
    }

    // 7. Text replacement
    const replacement = extractReplacementText(instruction);
    if (replacement && textHits.length > 0) {
      const target = textHits[0];
      await invoke('slide_set_text', {
        page_index: pageIndex,
        shape_index: target.shape_index,
        content: replacement,
      });
      summaries.push(`更新 ${target.shape_id} 文本为「${replacement}」`);
    }

    // 8. Generic polish / highlight fallback
    if (summaries.length === 0 && hits.length > 0) {
      const primary = hits[0];
      if (primary.type === 'chart') {
        await invoke('slide_update_chart_series_style', {
          page_index: pageIndex,
          shape_index: primary.shape_index,
          series_index: 0,
          color: '38E8D4',
        });
        summaries.push(`已优化高亮图表 ${primary.shape_id} 主系列配色`);
      } else if (primary.type === 'text') {
        await invoke('slide_set_text_property', {
          page_index: pageIndex,
          shape_index: primary.shape_index,
          bold: true,
          font_color: '38E8D4',
        });
        summaries.push(`已高亮强调选中文本 ${primary.shape_id}`);
      } else {
        await invoke('slide_set_shape_properties', {
          page_index: pageIndex,
          shape_index: primary.shape_index,
          border_color: '38E8D4',
          border_width: 2,
        });
        summaries.push(`已高亮选中容器 ${primary.shape_id} 边框`);
      }
    }
  }

  const latestEdits = engine.listRecentAiEdits(1);
  return {
    success: true,
    version: engine.getDeckRef().version,
    edit_id: latestEdits[0]?.edit_id,
    summary: summaries.join('；') || '已完成 AI 精准修改',
    tool_calls: toolCalls,
    page_index: pageIndex,
    affected_shape_ids: affectedIds,
    deck: engine.getDeck(),
  };
}
