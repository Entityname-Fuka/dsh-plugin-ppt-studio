import { DeckRegistry } from './dsh-compat';
import type {
  DshServerContext,
  DshToolDefinition,
  PptStudioServerConfig,
} from './dsh-compat';
import { registerPptStudioRoutes } from './routes';
import { createSlideTools } from './slide-tools';

export const name = 'dsh-plugin-ppt-studio';
export const inject = ['tools'] as const;

export function apply(
  ctx: DshServerContext,
  config?: PptStudioServerConfig
): () => void {
  const registry: DeckRegistry =
    config?.registry ??
    new DeckRegistry({
      requireDesignMd: config?.requireDesignMd,
      loadSampleDeck: config?.loadSampleDeck === true,
    });

  const tools = createSlideTools(registry, {
    requireDesignMd: config?.requireDesignMd,
  });

  const toolsMap = new Map<string, DshToolDefinition<any, any>>();
  const disposers: Array<() => void> = [];
  for (const tool of tools) {
    toolsMap.set(tool.name, tool);
    const dispose = ctx.tools.register(tool);
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  }

  const disposeRoutes = registerPptStudioRoutes(ctx, registry, toolsMap);
  disposers.push(disposeRoutes);

  ctx.logger?.info?.(
    `[dsh-plugin-ppt-studio] Registered ${tools.length} slide_* tools`
  );

  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) {
      disposers[i]();
    }
  };
}

export * from './dsh-compat';
export * from './slide-tools';
export * from './ai-edit-simulator';
export { PPT_STUDIO_API_PREFIX, registerPptStudioRoutes } from './routes';
