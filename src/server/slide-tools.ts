import {
  DeckEngine,
  buildSelectionPayload,
  createEmptyDeck,
  exportDeckToPptxBuffer,
  importDeckFromPptxBuffer,
  querySlideRegion,
} from '../core/index';
import type {
  BoundsPt,
  ChartSeries,
  ChartType,
  DashStyle,
  JsxPageNode,
  LineType,
  ShapeKind,
  SlideAnimation,
  SlideSelectionPayload,
  SlideTransitionType,
} from '../core/index';
import {
  DeckRegistry,
  DshToolDefinition,
  defineTool,
} from './dsh-compat';

function okResult<T extends Record<string, unknown>>(payload: T): T & { ok: true } {
  return { ok: true, ...payload };
}

function getTargetEngine(
  registry: DeckRegistry,
  args: { file_id?: string }
): DeckEngine {
  return registry.getEngine(args.file_id);
}

function runTrackedMutation<T>(
  registry: DeckRegistry,
  engine: DeckEngine,
  toolName: string,
  summary: string,
  fn: () => T,
  meta?: {
    page_index?: number;
    shape_ids?: string[];
    selection_range_id?: string;
  }
): { data: T; edit_id: string; version: number } {
  const { result, edit } = engine.runTrackedAiEdit(toolName, summary, fn, meta);
  registry.notifyChange(engine.getDeckRef().file_id);
  return {
    data: result,
    edit_id: edit.edit_id,
    version: engine.getDeckRef().version,
  };
}

export function createSlideTools(
  registry: DeckRegistry,
  options?: { requireDesignMd?: boolean }
): DshToolDefinition<any, any>[] {
  const requireDesignDefault = options?.requireDesignMd ?? false;

  return [
    // 1. slide_create_deck
    defineTool({
      name: 'slide_create_deck',
      description: 'Create a new blank 16:9 or 4:3 presentation deck and register it in DSH Studio.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          file_name: { type: 'string' },
          title: { type: 'string' },
          aspect_ratio: { type: 'integer', enum: [1, 2], description: '2 = 16:9 (960x540pt), 1 = 4:3 (720x540pt)' },
          theme_id: { type: 'string' },
          design_md: { type: 'string' },
          require_design_md: { type: 'boolean' },
        },
      },
      execute: (args) => {
        const deck = createEmptyDeck({
          file_id: args.file_id as string | undefined,
          file_name: args.file_name as string | undefined,
          title: args.title as string | undefined,
          aspect_ratio: (args.aspect_ratio as 1 | 2 | undefined) ?? 2,
          theme_id: args.theme_id as string | undefined,
          design_md: args.design_md as string | undefined,
        });
        const engine = registry.registerDeck(deck, {
          requireDesignMd:
            typeof args.require_design_md === 'boolean'
              ? args.require_design_md
              : requireDesignDefault,
        });
        registry.setActiveFileId(deck.file_id);
        return okResult({
          file_id: deck.file_id,
          file_name: deck.file_name,
          info: engine.getInfo(),
        });
      },
    }),

    // 2. slide_set_design
    defineTool({
      name: 'slide_set_design',
      description: 'Set or update the DESIGN.md contract on a presentation deck before generating slides.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          design_md: { type: 'string' },
        },
        required: ['design_md'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const deck = engine.setDesign(String(args.design_md ?? ''));
        registry.notifyChange(deck.file_id);
        return okResult({
          file_id: deck.file_id,
          version: deck.version,
          has_design_md: true,
        });
      },
    }),

    // 3. slide_get_info
    defineTool({
      name: 'slide_get_info',
      description: 'Get presentation metadata, canvas dimensions (pt), theme, and 0-based slide list.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
        },
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({ info: engine.getInfo() });
      },
    }),

    // 4. slide_get_page_info
    defineTool({
      name: 'slide_get_page_info',
      description: 'Get full 0-based element listing, bounds in pt, notes, and metadata for a slide page.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer', description: '0-based page index' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({
          page: engine.getPageInfo(Number(args.page_index)),
        });
      },
    }),

    // 5. slide_add_slide
    defineTool({
      name: 'slide_add_slide',
      description: 'Insert a blank slide at an optional 0-based insert_index (or append to end).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          insert_index: { type: 'integer' },
          title: { type: 'string' },
          background_color: { type: 'string' },
          notes: { type: 'string' },
          bypass_design_gate: { type: 'boolean' },
        },
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_slide',
          `新增幻灯片「${args.title ?? '空白页'}」`,
          () =>
            engine.addSlide({
              insert_index: args.insert_index as number | undefined,
              title: args.title as string | undefined,
              background_color: args.background_color as string | undefined,
              notes: args.notes as string | undefined,
              bypassDesignGate: args.bypass_design_gate as boolean | undefined,
            })
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 6. slide_add_page_with_jsx
    defineTool({
      name: 'slide_add_page_with_jsx',
      description: 'Compile a declarative <Slide>/<Box>/<Text>/<Chart>/<Table>/<SVG>/<Image> JSX string or JSON AST into a 960x540pt slide.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          jsx: { type: 'string', description: 'JSX markup string or structured JsxPageNode JSON object' },
          ast: {
            type: 'object',
            properties: {},
            additionalProperties: true,
            description: 'Optional structured JsxPageNode AST',
          },
          insert_index: { type: 'integer' },
          bypass_design_gate: { type: 'boolean' },
        },
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const input = (args.ast ?? args.jsx) as JsxPageNode | string;
        if (!input) {
          throw new Error('Must provide jsx markup string or ast object');
        }
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_page_with_jsx',
          '通过声明式 JSX 编排生成新幻灯片',
          () =>
            engine.addPageWithJsx({
              jsx: input,
              insert_index: args.insert_index as number | undefined,
              bypassDesignGate: args.bypass_design_gate as boolean | undefined,
            })
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 7. slide_duplicate_slide
    defineTool({
      name: 'slide_duplicate_slide',
      description: 'Duplicate an existing slide at 0-based page_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_duplicate_slide',
          `复制第 ${pageIndex + 1} 页幻灯片`,
          () => engine.duplicateSlide(pageIndex),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 8. slide_remove_slide
    defineTool({
      name: 'slide_remove_slide',
      description: 'Remove the slide at 0-based page_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_remove_slide',
          `删除第 ${pageIndex + 1} 页幻灯片`,
          () => engine.removeSlide(pageIndex),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 9. slide_move_slide
    defineTool({
      name: 'slide_move_slide',
      description: 'Move a slide from 0-based from_index to 0-based to_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          from_index: { type: 'integer' },
          to_index: { type: 'integer' },
        },
        required: ['from_index', 'to_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const fromIdx = Number(args.from_index);
        const toIdx = Number(args.to_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_move_slide',
          `移动幻灯片 P${fromIdx + 1} -> P${toIdx + 1}`,
          () => engine.moveSlide(fromIdx, toIdx)
        );
        return okResult({
          slide_count: tracked.data.slides.length,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 10. slide_set_page_properties
    defineTool({
      name: 'slide_set_page_properties',
      description: 'Update slide title, background color/gradient, or transition effect.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          title: { type: 'string' },
          background_color: { type: 'string' },
          background_gradient: { type: 'string' },
          transition_type: { type: 'string', enum: ['none', 'fade', 'push', 'wipe', 'zoom'] },
          transition_duration_ms: { type: 'integer' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_page_properties',
          `修改第 ${pageIndex + 1} 页属性`,
          () =>
            engine.setPageProperties(pageIndex, {
              title: args.title as string | undefined,
              background_color: args.background_color as string | undefined,
              background_gradient: args.background_gradient as string | undefined,
              transition_type: args.transition_type as SlideTransitionType | undefined,
              transition_duration_ms: args.transition_duration_ms as number | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          slide: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 11. slide_set_slide_size
    defineTool({
      name: 'slide_set_slide_size',
      description: 'Switch slide aspect ratio: 2 for 16:9 (960x540pt) or 1 for 4:3 (720x540pt).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          aspect_ratio: { type: 'integer', enum: [1, 2] },
        },
        required: ['aspect_ratio'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const aspect = Number(args.aspect_ratio) as 1 | 2;
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_slide_size',
          `调整画布比例为 ${aspect === 1 ? '4:3' : '16:9'}`,
          () => engine.setSlideSize(aspect)
        );
        return okResult({
          aspect_ratio: tracked.data.aspect_ratio,
          width_pt: tracked.data.width_pt,
          height_pt: tracked.data.height_pt,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 12. slide_get_shape_info
    defineTool({
      name: 'slide_get_shape_info',
      description: 'Inspect detailed bounds, styles, and text/table/chart payload of one element by 0-based shape_index or shape_id.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          shape_id: { type: 'string' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const element = engine.getShapeInfo(
          Number(args.page_index),
          args.shape_index as number | undefined,
          args.shape_id as string | undefined
        );
        return okResult({ element });
      },
    }),

    // 13. slide_add_shape
    defineTool({
      name: 'slide_add_shape',
      description: 'Add a geometric shape (rect/roundRect/ellipse/triangle/rightArrow/leftArrow/diamond) in pt. Must supply fill_color or border_color.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_id: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' },
          shape_type: { type: 'string', enum: ['rect', 'roundRect', 'ellipse', 'triangle', 'rightArrow', 'leftArrow', 'diamond'] },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          fill_color: { type: 'string' },
          fill_alpha: { type: 'number' },
          border_color: { type: 'string' },
          border_width: { type: 'number' },
          border_dash: { type: 'string', enum: ['solid', 'dash', 'dot'] },
          corner_radius: { type: 'number' },
          rotation: { type: 'number' },
          text: { type: 'string' },
          font_size: { type: 'number' },
          font_color: { type: 'string' },
          bold: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
        },
        required: ['page_index', 'x', 'y', 'w', 'h'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_shape',
          `在第 ${pageIndex + 1} 页添加形状`,
          () =>
            engine.addShape(pageIndex, {
              shape_id: args.shape_id as string | undefined,
              name: args.name as string | undefined,
              role: args.role as string | undefined,
              shape_type: args.shape_type as ShapeKind | undefined,
              x: Number(args.x),
              y: Number(args.y),
              w: Number(args.w),
              h: Number(args.h),
              fill_color: args.fill_color as string | undefined,
              fill_alpha: args.fill_alpha as number | undefined,
              border_color: args.border_color as string | undefined,
              border_width: args.border_width as number | undefined,
              border_dash: args.border_dash as DashStyle | undefined,
              corner_radius: args.corner_radius as number | undefined,
              rotation: args.rotation as number | undefined,
              text: args.text as string | undefined,
              font_size: args.font_size as number | undefined,
              font_color: args.font_color as string | undefined,
              bold: args.bold as boolean | undefined,
              align: args.align as 'left' | 'center' | 'right' | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 14. slide_add_shapes
    defineTool({
      name: 'slide_add_shapes',
      description: 'Batch insert multiple shapes onto a slide.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shapes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {},
              additionalProperties: true,
            },
          },
        },
        required: ['page_index', 'shapes'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const specs = (args.shapes as Array<Parameters<DeckEngine['addShape']>[1]>) ?? [];
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_shapes',
          `在第 ${pageIndex + 1} 页批量添加 ${specs.length} 个形状`,
          () => engine.addShapes(pageIndex, specs),
          { page_index: pageIndex }
        );
        return okResult({
          created: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 15. slide_add_line_shape
    defineTool({
      name: 'slide_add_line_shape',
      description: 'Add a line or arrow connector between (x1,y1) and (x2,y2) in pt.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_id: { type: 'string' },
          name: { type: 'string' },
          x1: { type: 'number' },
          y1: { type: 'number' },
          x2: { type: 'number' },
          y2: { type: 'number' },
          line_type: { type: 'string', enum: ['line', 'arrow', 'doubleArrow'] },
          color: { type: 'string' },
          width: { type: 'number' },
          dash: { type: 'string', enum: ['solid', 'dash', 'dot'] },
        },
        required: ['page_index', 'x1', 'y1', 'x2', 'y2'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_line_shape',
          `在第 ${pageIndex + 1} 页添加线条`,
          () =>
            engine.addLineShape(pageIndex, {
              shape_id: args.shape_id as string | undefined,
              name: args.name as string | undefined,
              x1: Number(args.x1),
              y1: Number(args.y1),
              x2: Number(args.x2),
              y2: Number(args.y2),
              line_type: args.line_type as LineType | undefined,
              color: args.color as string | undefined,
              width: args.width as number | undefined,
              dash: args.dash as DashStyle | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 16. slide_set_shape_properties
    defineTool({
      name: 'slide_set_shape_properties',
      description:
        'Update geometry, fill, border, or rotation for one shape (Mode A), 1-to-1 batch updates (Mode B), or shared patch across multiple shapes (Mode C).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          shape_id: { type: 'string' },
          shape_indices: { type: 'array', items: { type: 'integer' } },
          shape_ids: { type: 'array', items: { type: 'string' } },
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {},
              additionalProperties: true,
            },
          },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          rotation: { type: 'number' },
          fill_color: { type: 'string' },
          fill_alpha: { type: 'number' },
          border_color: { type: 'string' },
          border_width: { type: 'number' },
          border_dash: { type: 'string', enum: ['solid', 'dash', 'dot'] },
          corner_radius: { type: 'number' },
          name: { type: 'string' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_shape_properties',
          `修改第 ${pageIndex + 1} 页元素样式/位置`,
          () =>
            engine.setShapeProperties(pageIndex, {
              shape_index: args.shape_index as number | undefined,
              shape_id: args.shape_id as string | undefined,
              shape_indices: args.shape_indices as number[] | undefined,
              shape_ids: args.shape_ids as string[] | undefined,
              updates: args.updates as Array<Record<string, unknown>> | undefined,
              x: args.x as number | undefined,
              y: args.y as number | undefined,
              w: args.w as number | undefined,
              h: args.h as number | undefined,
              rotation: args.rotation as number | undefined,
              fill_color: args.fill_color as string | undefined,
              fill_alpha: args.fill_alpha as number | undefined,
              border_color: args.border_color as string | undefined,
              border_width: args.border_width as number | undefined,
              border_dash: args.border_dash as DashStyle | undefined,
              corner_radius: args.corner_radius as number | undefined,
              name: args.name as string | undefined,
            }),
          {
            page_index: pageIndex,
            shape_ids: args.shape_ids as string[] | undefined,
          }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 17. slide_remove_shapes
    defineTool({
      name: 'slide_remove_shapes',
      description: 'Remove one or more elements by 0-based shape_indices (or shape_ids).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_indices: { type: 'array', items: { type: 'integer' } },
          shape_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const page = engine.getPageInfo(pageIndex);
        let indices: number[] = Array.isArray(args.shape_indices)
          ? (args.shape_indices as number[])
          : [];
        if (indices.length === 0 && Array.isArray(args.shape_ids)) {
          const idSet = new Set(args.shape_ids as string[]);
          indices = page.elements
            .filter((el) => idSet.has(el.shape_id))
            .map((el) => el.shape_index);
        }
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_remove_shapes',
          `删除第 ${pageIndex + 1} 页 ${indices.length} 个元素`,
          () => engine.removeShapes(pageIndex, indices),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 18. slide_reorder_shape
    defineTool({
      name: 'slide_reorder_shape',
      description: 'Reorder element z-index: op 0=bringToFront, 1=sendToBack, 2=bringForward, 3=sendBackward.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          op: { type: 'integer', enum: [0, 1, 2, 3] },
        },
        required: ['page_index', 'shape_index', 'op'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_reorder_shape',
          `调整第 ${pageIndex + 1} 页元素层级`,
          () =>
            engine.reorderShape(
              pageIndex,
              Number(args.shape_index),
              Number(args.op) as 0 | 1 | 2 | 3
            ),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 19. slide_group_shapes
    defineTool({
      name: 'slide_group_shapes',
      description: 'Group 2 or more elements on a slide into a shared group_id.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_indices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['page_index', 'shape_indices'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_group_shapes',
          `组合第 ${pageIndex + 1} 页元素`,
          () => engine.groupShapes(pageIndex, args.shape_indices as number[]),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 20. slide_ungroup_shapes
    defineTool({
      name: 'slide_ungroup_shapes',
      description: 'Ungroup elements belonging to group_id.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          group_id: { type: 'string' },
        },
        required: ['page_index', 'group_id'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_ungroup_shapes',
          `取消组合第 ${pageIndex + 1} 页元素`,
          () => engine.ungroupShapes(pageIndex, String(args.group_id)),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 21. slide_get_text
    defineTool({
      name: 'slide_get_text',
      description: 'Read text content and typography properties from an element.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({
          text: engine.getText(Number(args.page_index), Number(args.shape_index)),
        });
      },
    }),

    // 22. slide_add_text
    defineTool({
      name: 'slide_add_text',
      description: 'Add a text box element at (x, y, w, h) in pt.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_id: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          content: { type: 'string' },
          font_name: { type: 'string' },
          font_size: { type: 'number' },
          font_color: { type: 'string' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          v_align: { type: 'string', enum: ['top', 'middle', 'bottom'] },
          line_height: { type: 'number' },
        },
        required: ['page_index', 'x', 'y', 'w', 'h', 'content'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_text',
          `在第 ${pageIndex + 1} 页添加文本框`,
          () =>
            engine.addText(pageIndex, {
              shape_id: args.shape_id as string | undefined,
              name: args.name as string | undefined,
              role: args.role as string | undefined,
              x: Number(args.x),
              y: Number(args.y),
              w: Number(args.w),
              h: Number(args.h),
              content: String(args.content),
              font_name: args.font_name as string | undefined,
              font_size: args.font_size as number | undefined,
              font_color: args.font_color as string | undefined,
              bold: args.bold as boolean | undefined,
              italic: args.italic as boolean | undefined,
              underline: args.underline as boolean | undefined,
              align: args.align as 'left' | 'center' | 'right' | undefined,
              v_align: args.v_align as 'top' | 'middle' | 'bottom' | undefined,
              line_height: args.line_height as number | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 23. slide_set_text
    defineTool({
      name: 'slide_set_text',
      description: 'Replace the text content of an element at 0-based page_index and shape_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          content: { type: 'string' },
        },
        required: ['page_index', 'shape_index', 'content'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const shapeIndex = Number(args.shape_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_text',
          `更新第 ${pageIndex + 1} 页元素 #${shapeIndex} 文本`,
          () => engine.setText(pageIndex, shapeIndex, String(args.content)),
          { page_index: pageIndex }
        );
        return okResult({
          element: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 24. slide_append_text
    defineTool({
      name: 'slide_append_text',
      description: 'Append a new line of text to an element.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['page_index', 'shape_index', 'text'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const shapeIndex = Number(args.shape_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_append_text',
          `向第 ${pageIndex + 1} 页元素 #${shapeIndex} 追加文本`,
          () => engine.appendText(pageIndex, shapeIndex, String(args.text)),
          { page_index: pageIndex }
        );
        return okResult({
          element: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 25. slide_set_text_property
    defineTool({
      name: 'slide_set_text_property',
      description: 'Update typography properties (font_size, font_color, bold, italic, underline, align, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          font_name: { type: 'string' },
          font_size: { type: 'number' },
          font_color: { type: 'string' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          v_align: { type: 'string', enum: ['top', 'middle', 'bottom'] },
          line_height: { type: 'number' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const shapeIndex = Number(args.shape_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_text_property',
          `修改第 ${pageIndex + 1} 页元素 #${shapeIndex} 字体样式`,
          () =>
            engine.setTextProperty(pageIndex, shapeIndex, {
              font_name: args.font_name as string | undefined,
              font_size: args.font_size as number | undefined,
              font_color: args.font_color as string | undefined,
              bold: args.bold as boolean | undefined,
              italic: args.italic as boolean | undefined,
              underline: args.underline as boolean | undefined,
              align: args.align as 'left' | 'center' | 'right' | undefined,
              v_align: args.v_align as 'top' | 'middle' | 'bottom' | undefined,
              line_height: args.line_height as number | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          element: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 26. slide_find_text
    defineTool({
      name: 'slide_find_text',
      description: 'Search text across all slides or a specific 0-based page_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          query: { type: 'string' },
          page_index: { type: 'integer' },
        },
        required: ['query'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const matches = engine.findText(
          String(args.query),
          args.page_index as number | undefined
        );
        return okResult({ matches, count: matches.length });
      },
    }),

    // 27. slide_find_replace_text
    defineTool({
      name: 'slide_find_replace_text',
      description: 'Find and replace text across the deck or on a single slide.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' },
          page_index: { type: 'integer' },
        },
        required: ['find', 'replace'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_find_replace_text',
          `批量替换文本「${args.find}」->「${args.replace}」`,
          () =>
            engine.findReplaceText(
              String(args.find),
              String(args.replace),
              args.page_index as number | undefined
            ),
          { page_index: args.page_index as number | undefined }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 28. slide_add_table
    defineTool({
      name: 'slide_add_table',
      description: 'Add a table element with 0-based rows/cols or initial 2D string data array.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_id: { type: 'string' },
          name: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          rows: { type: 'integer' },
          cols: { type: 'integer' },
          data: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          header_bg: { type: 'string' },
          zebra_bg: { type: 'string' },
          border_color: { type: 'string' },
        },
        required: ['page_index', 'x', 'y', 'w', 'h'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_table',
          `在第 ${pageIndex + 1} 页添加表格`,
          () =>
            engine.addTable(pageIndex, {
              shape_id: args.shape_id as string | undefined,
              name: args.name as string | undefined,
              x: Number(args.x),
              y: Number(args.y),
              w: Number(args.w),
              h: Number(args.h),
              rows: args.rows as number | undefined,
              cols: args.cols as number | undefined,
              data: args.data as string[][] | undefined,
              header_bg: args.header_bg as string | undefined,
              zebra_bg: args.zebra_bg as string | undefined,
              border_color: args.border_color as string | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 29. slide_get_table_info
    defineTool({
      name: 'slide_get_table_info',
      description: 'Inspect table rows, cols, and cell matrix.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({
          table: engine.getTableInfo(
            Number(args.page_index),
            Number(args.shape_index)
          ),
        });
      },
    }),

    // 30. slide_set_cell_text
    defineTool({
      name: 'slide_set_cell_text',
      description: 'Update text in a table cell using 0-based row and col.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          row: { type: 'integer' },
          col: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['page_index', 'shape_index', 'row', 'col', 'text'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_cell_text',
          `修改第 ${pageIndex + 1} 页单元格 (${args.row}, ${args.col}) 文本`,
          () =>
            engine.setCellText(
              pageIndex,
              Number(args.shape_index),
              Number(args.row),
              Number(args.col),
              String(args.text)
            ),
          { page_index: pageIndex }
        );
        return okResult({
          table: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 31. slide_set_cell_style
    defineTool({
      name: 'slide_set_cell_style',
      description: 'Style a table cell at 0-based (row, col).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          row: { type: 'integer' },
          col: { type: 'integer' },
          bg_color: { type: 'string' },
          font_color: { type: 'string' },
          font_size: { type: 'number' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
        },
        required: ['page_index', 'shape_index', 'row', 'col'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_cell_style',
          `修改第 ${pageIndex + 1} 页单元格 (${args.row}, ${args.col}) 样式`,
          () =>
            engine.setCellStyle(
              pageIndex,
              Number(args.shape_index),
              Number(args.row),
              Number(args.col),
              {
                bg_color: args.bg_color as string | undefined,
                font_color: args.font_color as string | undefined,
                font_size: args.font_size as number | undefined,
                bold: args.bold as boolean | undefined,
                italic: args.italic as boolean | undefined,
                align: args.align as 'left' | 'center' | 'right' | undefined,
              }
            ),
          { page_index: pageIndex }
        );
        return okResult({
          table: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 32. slide_merge_table_cells
    defineTool({
      name: 'slide_merge_table_cells',
      description: 'Merge a rectangular range of table cells (0-based inclusive indices).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          start_row: { type: 'integer' },
          start_col: { type: 'integer' },
          end_row: { type: 'integer' },
          end_col: { type: 'integer' },
        },
        required: [
          'page_index',
          'shape_index',
          'start_row',
          'start_col',
          'end_row',
          'end_col',
        ],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_merge_table_cells',
          `合并第 ${pageIndex + 1} 页表格单元格`,
          () =>
            engine.mergeTableCells(
              pageIndex,
              Number(args.shape_index),
              Number(args.start_row),
              Number(args.start_col),
              Number(args.end_row),
              Number(args.end_col)
            ),
          { page_index: pageIndex }
        );
        return okResult({
          table: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 33. slide_add_chart
    defineTool({
      name: 'slide_add_chart',
      description: 'Add a vector chart (bar/line/pie/area) at (x, y, w, h) pt.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_id: { type: 'string' },
          name: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          chart_type: { type: 'string', enum: ['bar', 'line', 'pie', 'area'] },
          title: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          series: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                values: { type: 'array', items: { type: 'number' } },
                color: { type: 'string' },
              },
              required: ['name', 'values'],
              additionalProperties: true,
            },
          },
          show_legend: { type: 'boolean' },
          show_gridlines: { type: 'boolean' },
          show_data_labels: { type: 'boolean' },
          y_axis_max: { type: 'number' },
          y_axis_step: { type: 'number' },
          unit: { type: 'string' },
        },
        required: ['page_index', 'x', 'y', 'w', 'h', 'chart_type', 'categories', 'series'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_chart',
          `在第 ${pageIndex + 1} 页添加图表`,
          () =>
            engine.addChart(pageIndex, {
              shape_id: args.shape_id as string | undefined,
              name: args.name as string | undefined,
              x: Number(args.x),
              y: Number(args.y),
              w: Number(args.w),
              h: Number(args.h),
              chart_type: args.chart_type as ChartType,
              title: args.title as string | undefined,
              categories: (args.categories as string[]) ?? [],
              series: (args.series as ChartSeries[]) ?? [],
              show_legend: args.show_legend as boolean | undefined,
              show_gridlines: args.show_gridlines as boolean | undefined,
              show_data_labels: args.show_data_labels as boolean | undefined,
              y_axis_max: args.y_axis_max as number | undefined,
              y_axis_step: args.y_axis_step as number | undefined,
              unit: args.unit as string | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 34. slide_get_chart_info
    defineTool({
      name: 'slide_get_chart_info',
      description: 'Read chart type, categories, and series data.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({
          chart: engine.getChartInfo(
            Number(args.page_index),
            Number(args.shape_index)
          ),
        });
      },
    }),

    // 35. slide_update_chart_data
    defineTool({
      name: 'slide_update_chart_data',
      description: 'Update chart categories, series values, title, or axis limits.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          title: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          series: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                values: { type: 'array', items: { type: 'number' } },
                color: { type: 'string' },
              },
              required: ['name', 'values'],
              additionalProperties: true,
            },
          },
          unit: { type: 'string' },
          y_axis_max: { type: 'number' },
          y_axis_step: { type: 'number' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_update_chart_data',
          `更新第 ${pageIndex + 1} 页图表数据`,
          () =>
            engine.updateChartData(pageIndex, Number(args.shape_index), {
              title: args.title as string | undefined,
              categories: args.categories as string[] | undefined,
              series: args.series as ChartSeries[] | undefined,
              unit: args.unit as string | undefined,
              y_axis_max: args.y_axis_max as number | undefined,
              y_axis_step: args.y_axis_step as number | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          chart: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 36. slide_change_chart_type
    defineTool({
      name: 'slide_change_chart_type',
      description: 'Switch chart visualization type between bar, line, pie, and area.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          chart_type: { type: 'string', enum: ['bar', 'line', 'pie', 'area'] },
        },
        required: ['page_index', 'shape_index', 'chart_type'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const chartType = args.chart_type as ChartType;
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_change_chart_type',
          `将第 ${pageIndex + 1} 页图表切换为 ${chartType}`,
          () =>
            engine.changeChartType(
              pageIndex,
              Number(args.shape_index),
              chartType
            ),
          { page_index: pageIndex }
        );
        return okResult({
          chart: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 37. slide_update_chart_series_style
    defineTool({
      name: 'slide_update_chart_series_style',
      description: 'Update chart series display name or hex color (0-based series_index).',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          series_index: { type: 'integer' },
          name: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['page_index', 'shape_index', 'series_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_update_chart_series_style',
          `更新第 ${pageIndex + 1} 页图表系列 #${args.series_index} 配色`,
          () =>
            engine.updateChartSeriesStyle(
              pageIndex,
              Number(args.shape_index),
              Number(args.series_index),
              {
                name: args.name as string | undefined,
                color: args.color as string | undefined,
              }
            ),
          { page_index: pageIndex }
        );
        return okResult({
          chart: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 38. slide_list_anim_types
    defineTool({
      name: 'slide_list_anim_types',
      description: 'List supported slide animation types and subtypes.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: () => {
        const engine = registry.getEngine();
        return okResult({ anim_types: engine.listAnimTypes() });
      },
    }),

    // 39. slide_add_anim
    defineTool({
      name: 'slide_add_anim',
      description: 'Attach an entrance/emphasis/exit animation to a slide element.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          anim_type: { type: 'string' },
          anim_subtype: { type: 'string' },
          category: { type: 'string', enum: ['entrance', 'emphasis', 'exit', 'motion'] },
          trigger: { type: 'string', enum: ['onClick', 'withPrevious', 'afterPrevious'] },
          duration_ms: { type: 'integer' },
          delay_ms: { type: 'integer' },
        },
        required: ['page_index', 'shape_index', 'anim_type'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_add_anim',
          `为第 ${pageIndex + 1} 页元素 #${args.shape_index} 添加动画`,
          () =>
            engine.addAnim(pageIndex, Number(args.shape_index), {
              anim_type: String(args.anim_type),
              anim_subtype: args.anim_subtype as string | undefined,
              category: args.category as SlideAnimation['category'] | undefined,
              trigger: args.trigger as SlideAnimation['trigger'] | undefined,
              duration_ms: args.duration_ms as number | undefined,
              delay_ms: args.delay_ms as number | undefined,
            }),
          { page_index: pageIndex }
        );
        return okResult({
          animation: tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 40. slide_remove_anim
    defineTool({
      name: 'slide_remove_anim',
      description: 'Remove a specific animation by anim_id or all animations on an element.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          shape_index: { type: 'integer' },
          anim_id: { type: 'string' },
        },
        required: ['page_index', 'shape_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_remove_anim',
          `移除第 ${pageIndex + 1} 页元素 #${args.shape_index} 动画`,
          () =>
            engine.removeAnim(
              pageIndex,
              Number(args.shape_index),
              args.anim_id as string | undefined
            ),
          { page_index: pageIndex }
        );
        return okResult({
          ...tracked.data,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 41. slide_list_builtin_themes
    defineTool({
      name: 'slide_list_builtin_themes',
      description: 'List built-in presentation color themes.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: () => {
        const engine = registry.getEngine();
        return okResult({ themes: engine.listBuiltinThemes() });
      },
    }),

    // 42. slide_set_theme
    defineTool({
      name: 'slide_set_theme',
      description: 'Apply a built-in theme across the presentation.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          theme_id: { type: 'string' },
          apply_to_existing_slides: { type: 'boolean' },
        },
        required: ['theme_id'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_theme',
          `切换全篇主题为 ${args.theme_id}`,
          () =>
            engine.setTheme(
              String(args.theme_id),
              args.apply_to_existing_slides as boolean | undefined
            )
        );
        return okResult({
          theme_id: tracked.data.theme_id,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 43. slide_get_notes_text
    defineTool({
      name: 'slide_get_notes_text',
      description: 'Read speaker notes for a slide at 0-based page_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
        },
        required: ['page_index'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        return okResult({
          page_index: Number(args.page_index),
          notes: engine.getNotesText(Number(args.page_index)),
        });
      },
    }),

    // 44. slide_set_notes_text
    defineTool({
      name: 'slide_set_notes_text',
      description: 'Write speaker notes for a slide at 0-based page_index.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          notes: { type: 'string' },
        },
        required: ['page_index', 'notes'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const pageIndex = Number(args.page_index);
        const tracked = runTrackedMutation(
          registry,
          engine,
          'slide_set_notes_text',
          `更新第 ${pageIndex + 1} 页演讲者备注`,
          () => engine.setNotesText(pageIndex, String(args.notes)),
          { page_index: pageIndex }
        );
        return okResult({
          page_index: pageIndex,
          notes: tracked.data.notes,
          edit_id: tracked.edit_id,
          version: tracked.version,
        });
      },
    }),

    // 45. slide_list_recent_ai_edits
    defineTool({
      name: 'slide_list_recent_ai_edits',
      description: 'List recent versioned AI edits on the presentation for auditing and undo.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const edits = engine.listRecentAiEdits(
          (args.limit as number | undefined) ?? 20
        );
        return okResult({
          edits: edits.map(({ before_snapshot: _omit, ...rest }) => rest),
          count: edits.length,
        });
      },
    }),

    // 46. slide_undo_ai_edit
    defineTool({
      name: 'slide_undo_ai_edit',
      description: 'Undo the latest (or specified edit_id) AI edit cleanly and restore the pre-edit slide snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          edit_id: { type: 'string' },
        },
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const res = engine.undoAiEdit(args.edit_id as string | undefined);
        registry.notifyChange(res.deck.file_id);
        return okResult({
          reverted_edit_id: res.reverted_edit.edit_id,
          reverted_summary: res.reverted_edit.summary,
          version: res.deck.version,
        });
      },
    }),

    // 47. slide_query_region (Fine-grained spatial index query)
    defineTool({
      name: 'slide_query_region',
      description:
        'Query all slide elements intersecting a rectangular marquee bbox_pt on 0-based page_index, returning overlap_ratio, 0-based shape_index, shape_id, and recommended_tools.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          page_index: { type: 'integer' },
          bbox_pt: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
          min_overlap_ratio: { type: 'number' },
        },
        required: ['page_index', 'bbox_pt'],
      },
      execute: (args) => {
        const engine = getTargetEngine(registry, args);
        const result = querySlideRegion(
          engine.getDeckRef(),
          Number(args.page_index),
          args.bbox_pt as BoundsPt,
          {
            minOverlapRatio: (args.min_overlap_ratio as number | undefined) ?? 0.05,
            selectionMode: 'free-marquee',
          }
        );
        return okResult({ region: result });
      },
    }),

    // 48. slide_resolve_selection
    defineTool({
      name: 'slide_resolve_selection',
      description:
        'Resolve a tdoc-selection:// URI, rangeId, or selection_payload against the live deck to obtain fresh 0-based shape indices and bounds.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          uri_or_range_id: { type: 'string' },
          selection_payload: {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        },
      },
      execute: (args) => {
        const rawPayload = args.selection_payload as
          | Partial<SlideSelectionPayload>
          | undefined;
        const recorded = args.uri_or_range_id
          ? registry.getRecordedSelection(String(args.uri_or_range_id))
          : undefined;
        const seed = rawPayload ?? recorded;
        if (!seed || seed.page_index === undefined) {
          throw new Error(
            'Unable to resolve selection: provide selection_payload or a recorded rangeId/tdoc-selection:// URI'
          );
        }
        const engine = registry.getEngine(
          (args.file_id as string | undefined) ?? seed.fileId
        );
        const deck = engine.getDeckRef();
        const resolved = buildSelectionPayload(deck, seed.page_index, {
          rangeId: seed.rangeId,
          bbox_pt: seed.shape_ids?.length ? undefined : seed.bbox_pt,
          shape_ids: seed.shape_ids,
          shape_indices: seed.shape_indices,
          selection_mode: seed.selection_mode,
        });
        return okResult({ selection: resolved });
      },
    }),

    // 49. slide_save_pptx
    defineTool({
      name: 'slide_save_pptx',
      description:
        'Export the active or specified presentation deck as a real standard 16:9 .pptx file and write it to disk.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: 'Optional deck file_id; defaults to active deck.' },
          file_path: { type: 'string', description: 'Destination path on disk (.pptx). Defaults to deck.file_path.' },
        },
      },
      execute: async (args) => {
        const engine = getTargetEngine(registry, args);
        const deck = engine.getDeck();
        const rawPath =
          typeof args.file_path === 'string' && args.file_path.trim()
            ? args.file_path.trim()
            : deck.file_path;
        if (!rawPath) {
          throw new Error('slide_save_pptx requires file_path or an existing deck.file_path');
        }
        const fsMod = 'node:fs/promises';
        const pathMod = 'node:path';
        const fs = (await import(/* @vite-ignore */ fsMod)) as typeof import('node:fs/promises');
        const path = (await import(/* @vite-ignore */ pathMod)) as typeof import('node:path');
        const absPath = path.resolve(rawPath);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        const buffer = await exportDeckToPptxBuffer(deck);
        await fs.writeFile(absPath, buffer);
        const liveDeck = engine.getDeckRef();
        liveDeck.file_path = absPath;
        liveDeck.file_name = path.basename(absPath);
        registry.notifyChange(liveDeck.file_id);
        return okResult({
          file_id: liveDeck.file_id,
          file_name: liveDeck.file_name,
          file_path: absPath,
          bytes: buffer.byteLength,
          slide_count: liveDeck.slides.length,
        });
      },
    }),

    // 50. slide_open_pptx
    defineTool({
      name: 'slide_open_pptx',
      description:
        'Open an existing .pptx file from disk into DSH PPT Studio for preview, block selection, and fine-grained editing.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or workspace-relative path to the .pptx file on disk.' },
        },
        required: ['file_path'],
      },
      execute: async (args) => {
        const rawPath = typeof args.file_path === 'string' ? args.file_path.trim() : '';
        if (!rawPath) {
          throw new Error('slide_open_pptx requires a non-empty file_path');
        }
        const fsMod = 'node:fs/promises';
        const pathMod = 'node:path';
        const fs = (await import(/* @vite-ignore */ fsMod)) as typeof import('node:fs/promises');
        const path = (await import(/* @vite-ignore */ pathMod)) as typeof import('node:path');
        const absPath = path.resolve(rawPath);
        const buffer = await fs.readFile(absPath);
        const fileName = path.basename(absPath);
        const deck = await importDeckFromPptxBuffer(buffer, {
          fileName,
          filePath: absPath,
        });
        deck.file_path = absPath;
        const engine = registry.registerDeck(deck);
        registry.setActiveFileId(deck.file_id);
        return okResult({
          file_id: deck.file_id,
          file_name: deck.file_name,
          file_path: absPath,
          info: engine.getInfo(),
        });
      },
    }),
  ];
}
