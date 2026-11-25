import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Compass,
  Copy,
  ExternalLink,
  Filter,
  FolderKanban,
  Layers,
  Mic,
  MoreHorizontal,
  PanelLeft,
  PanelRightOpen,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from 'lucide-react';
import { PPT_QUICK_ACTIONS, SELECTION_URI_SCHEME } from '../core/constants';
import { renderTencentDocsSelectionPrompt } from '../core/context-index';
import type {
  AiEditResult,
  DocumentSelectionContextBlock,
  SlideSelectionPayload,
} from '../core/types';
import type { DshArtifactItem, SelectionFocusTarget } from '../client/dsh-types';
import { MockDshHost } from './mock-dsh-host';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  blocks?: DocumentSelectionContextBlock[];
  xmlPreview?: string;
  aiEditResult?: AiEditResult;
}

const RECENT_TASKS = [
  { id: 't1', title: '制作未来算力与智能体趋势PPT', time: '18小时前', active: true },
  { id: 't2', title: '架构设计评审记录', time: '10月28日', active: false },
  { id: 't3', title: '技术方案调研', time: '10月20日', active: false },
  { id: 't4', title: '查询可用的子 agent', time: '10月20日', active: false },
  { id: 't5', title: '视觉排版自检任务', time: '10月15日', active: false },
];

export interface DesktopShellProps {
  host?: MockDshHost;
}

export const DesktopShell: React.FC<DesktopShellProps> = ({ host: providedHost }) => {
  const host = useMemo(() => providedHost ?? new MockDshHost(), [providedHost]);
  const state = useSyncExternalStore(host.subscribe, host.getState, host.getState);

  const [composerText, setComposerText] = useState('');
  const [extraTurns, setExtraTurns] = useState<ChatTurn[]>([]);
  const [allArtifactsOpen, setAllArtifactsOpen] = useState(false);
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false);

  const activeDeck =
    state.decks.find((d) => d.file_id === state.activeDeckId) ?? state.decks[0];
  const primaryArtifact = host.getArtifactForActiveDeck();

  const handleSubmitPrompt = async (
    promptText: string,
    blocksOverride?: DocumentSelectionContextBlock[],
  ) => {
    const blocks = blocksOverride ?? host.selectionBus.getBlocks();
    const trimmed = promptText.trim();
    if (!trimmed && blocks.length === 0) return;

    const effectivePrompt = trimmed || '请优化当前选中区域的视觉与文本表达';
    const xmlPreview =
      blocks.length > 0
        ? renderTencentDocsSelectionPrompt(blocks, effectivePrompt)
        : undefined;

    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: effectivePrompt,
      blocks: [...blocks],
      xmlPreview,
    };
    setExtraTurns((prev) => [...prev, userTurn]);
    setComposerText('');
    if (!blocksOverride) {
      host.selectionBus.clearBlocks();
    }

    const selectionPayload = blocks[0]?._meta.selectionPayload as
      | SlideSelectionPayload
      | undefined;
    try {
      const result = await host.runAiSelectionEdit(
        selectionPayload,
        effectivePrompt,
        activeDeck,
      );
      const toolSummary = result.tool_calls
        .map((tc) => `${tc.tool}(${JSON.stringify(tc.args)})`)
        .join('\n');

      const assistantTurn: ChatTurn = {
        id: `a_${Date.now() + 1}`,
        role: 'assistant',
        text: `已通过 DSH 服务端插件精准修改第 ${result.page_index + 1} 页（0-based page_index: ${result.page_index}）：${result.summary}\n\n调用工具：\n${toolSummary}`,
        aiEditResult: result,
      };
      setExtraTurns((prev) => [...prev, assistantTurn]);
    } catch (err) {
      const errTurn: ChatTurn = {
        id: `a_${Date.now() + 1}`,
        role: 'assistant',
        text: `执行局部编辑时出现提示：${err instanceof Error ? err.message : String(err)}`,
      };
      setExtraTurns((prev) => [...prev, errTurn]);
    }
  };

  // 注册 office-selection-wakeup 发送回调（支持画布 HUD 内联直发 docs:selectionSend）
  useEffect(() => {
    host.selectionBus.registerSendHandler(({ prompt, blocks }) => {
      void handleSubmitPrompt(prompt, blocks);
    });
    return () => host.selectionBus.registerSendHandler(null);
  }, [host, activeDeck?.file_id]);

  const artifactProps = primaryArtifact
    ? {
        artifact: primaryArtifact,
        onOpenArtifact: (art: DshArtifactItem) => {
          if (art.fileId) host.clientCtx.bridge?.setActiveDeckId(art.fileId);
          host.setRightSidebarOpen(true);
        },
        onOpenWindow: () => setStandaloneModalOpen(true),
        onShareArtifact: () => {
          void host.exportActivePptx();
        },
        onViewAllArtifacts: () => setAllArtifactsOpen(true),
      }
    : null;

  return (
    <div className="dsh-plugin-root dsh-desktop-shell-root dsh-desktop-shell">
      {/* ==================== 左栏：任务与历史导航 ==================== */}
      <aside className="dsh-left-sidebar" aria-label="DSH 导航栏">
        <div className="dsh-window-topbar">
          <div className="dsh-traffic-dots" aria-hidden="true">
            <span className="dsh-dot dsh-dot-red" />
            <span className="dsh-dot dsh-dot-yellow" />
            <span className="dsh-dot dsh-dot-green" />
          </div>
          <div className="dsh-topbar-actions">
            <button type="button" className="dsh-icon-btn" title="折叠导航">
              <PanelLeft size={14} />
            </button>
            <button type="button" className="dsh-icon-btn" title="搜索任务">
              <Search size={14} />
            </button>
            <button type="button" className="dsh-icon-btn" title="筛选">
              <Filter size={14} />
            </button>
          </div>
        </div>

        <div className="dsh-brand-row">
          <div className="dsh-brand-title">
            <span className="dsh-brand-name">DSH Desktop</span>
            <span className="dsh-brand-version">1.0.0</span>
          </div>
          <button type="button" className="dsh-discover-pill">
            <span>发现应用</span>
            <ChevronDown size={11} />
          </button>
        </div>

        <nav className="dsh-nav-list">
          <button
            type="button"
            className="dsh-nav-item"
            onClick={() => host.showToast('已新建对话任务上下文')}
          >
            <PlusCircle size={15} />
            <span>新建任务</span>
          </button>
          <button type="button" className="dsh-nav-item">
            <Bot size={15} />
            <span>助理</span>
            <span className="dsh-beta-badge">BETA</span>
          </button>
          <button type="button" className="dsh-nav-item">
            <Layers size={15} />
            <span>专家·技能·连接器</span>
          </button>
          <button type="button" className="dsh-nav-item">
            <CalendarClock size={15} />
            <span>定时任务</span>
          </button>
          <button type="button" className="dsh-nav-item">
            <BookOpen size={15} />
            <span>资料库</span>
          </button>
          <button type="button" className="dsh-nav-item">
            <Compass size={15} />
            <span>发现</span>
          </button>
        </nav>

        <div className="dsh-recent-section">
          <div className="dsh-recent-heading">最近</div>
          {RECENT_TASKS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dsh-recent-item ${t.active ? 'is-active' : ''}`}
            >
              <span className="dsh-recent-item-title">{t.title}</span>
              <span className="dsh-recent-item-time">{t.time}</span>
            </button>
          ))}
          <button
            type="button"
            className="dsh-recent-item"
            style={{ color: '#6b7280', marginTop: 2 }}
          >
            <span>查看更多 (4)</span>
          </button>
        </div>

        <div className="dsh-sidebar-promo-card">
          <div className="dsh-promo-title">PPT Studio 插件已挂载</div>
          <div className="dsh-promo-sub">
            {host.getRegisteredToolNames().length} 个 slide_* 工具就绪
          </div>
          <div className="dsh-promo-footer">
            <div className="dsh-promo-dots">
              <span className="dsh-promo-dot" />
              <span className="dsh-promo-dot muted" />
            </div>
            <button
              type="button"
              className="dsh-promo-btn"
              onClick={() => setAllArtifactsOpen(true)}
            >
              查看产物
            </button>
          </div>
        </div>

        <div className="dsh-sidebar-footer">
          <div className="dsh-user-badge">
            <span className="dsh-user-avatar">D</span>
            <span>DSH·Studio</span>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button type="button" className="dsh-icon-btn" title="通知">
              <Bell size={14} />
            </button>
            <button
              type="button"
              className="dsh-icon-btn"
              title="切换右侧 PPT 面板"
              onClick={() => host.setRightSidebarOpen(!state.rightSidebarOpen)}
            >
              <FolderKanban size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ==================== 中栏：Agent 对话流 + Composer ==================== */}
      <main className="dsh-chat-column">
        <header className="dsh-chat-header">
          <div className="dsh-chat-title">制作未来算力与智能体趋势PPT</div>
          <div className="dsh-chat-header-actions">
            <button type="button" className="dsh-icon-btn" title="搜索对话">
              <Search size={15} />
            </button>
            <button
              type="button"
              className="dsh-icon-btn"
              title="分享对话"
              onClick={() => host.showToast('已复制任务摘要')}
            >
              <Share2 size={15} />
            </button>
            {!state.rightSidebarOpen && (
              <button
                type="button"
                className="dsh-icon-btn"
                title="展开右侧 PPT 工作区"
                onClick={() => host.setRightSidebarOpen(true)}
              >
                <PanelRightOpen size={15} />
              </button>
            )}
            <button
              type="button"
              className="dsh-icon-btn"
              title="独立窗口预览"
              onClick={() => setStandaloneModalOpen(true)}
            >
              <ExternalLink size={15} />
            </button>
          </div>
        </header>

        <div className="dsh-chat-scroll">
          <article className="dsh-msg-assistant">
            <ul>
              <li>
                <strong>市场预测</strong>：2026–2030 全球智能算力规模、推理负载占比与单位 Token 成本下降曲线
              </li>
              <li>
                <strong>管理层行动</strong>：选战场、建护栏、算清账，附 90 天落地路线与验证指标
              </li>
            </ul>

            <h4>视觉与图表</h4>
            <p style={{ margin: '4px 0 8px' }}>
              采用深海蓝 <code>#090D18</code> 底色、荧光青 <code>#38E8D4</code> 与数字紫{' '}
              <code>#846BFF</code>；包含趋势矩阵、算力对比表、推理/训练负载柱图与智能体渗透率图，每页均完成{' '}
              <code>DESIGN.md</code> 门禁与版式自检。
            </p>

            <h4>核心判断</h4>
            <p style={{ margin: '4px 0 8px' }}>
              产业评估标准正从“单模型跑分”转向“工作流闭环 + 单位 Token 成本”：编码智能体与企业级推理算力最先规模化兑现；建议优先部署可闭环验证的高频场景，并同步建立工具调用护栏与全链路成本核算。
            </p>

            <p style={{ margin: '4px 0 6px' }}>
              数据口径基于内部研究基准与公开行业测算，页脚均标注来源与单位；右侧工作区支持传统 PPT 编辑与{' '}
              <strong>自由框选模式</strong> 细粒度 AI 联动修改。
            </p>

            <div className="dsh-msg-source-note">
              <span>DSH 本地 PPT Studio 引擎生成 ›</span>
            </div>

            {/* 入口 1：通过 conversation.message.artifact Slot 真实渲染产物卡片 */}
            {artifactProps && host.renderSlot('conversation.message.artifact', artifactProps)}

            <div className="dsh-msg-toolbar">
              <button type="button" className="dsh-icon-btn" title="复制回复">
                <Copy size={13} />
              </button>
              <button type="button" className="dsh-icon-btn" title="赞">
                <ThumbsUp size={13} />
              </button>
              <button type="button" className="dsh-icon-btn" title="踩">
                <ThumbsDown size={13} />
              </button>
              <button type="button" className="dsh-icon-btn" title="朗读">
                <Volume2 size={13} />
              </button>
              <button type="button" className="dsh-icon-btn" title="重新生成">
                <RefreshCw size={13} />
              </button>
              <button type="button" className="dsh-icon-btn" title="更多">
                <MoreHorizontal size={13} />
              </button>
              <span className="dsh-msg-toolbar-sep">|</span>
              <span>共消耗 ◇ 0</span>
              <span className="dsh-msg-toolbar-sep">|</span>
              <span>DeepSeek-V3</span>
            </div>
          </article>

          {/* 动态交互对话回合（框选引用 / AI 精准修改） */}
          {extraTurns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="dsh-msg-user">
                {turn.blocks && turn.blocks.length > 0 && (
                  <div className="dsh-msg-user-chips">
                    {turn.blocks.map((b) => (
                      <button
                        key={b.uri}
                        type="button"
                        className="dsh-selection-chip"
                        onClick={() => {
                          const p = b._meta.selectionPayload;
                          host.focusSelectionTarget({
                            fileId: b._meta.fileId,
                            page_index: p.page_index,
                            shape_ids: p.shape_ids,
                            bbox_pt: p.bbox_pt,
                          });
                        }}
                      >
                        <span className="dsh-ppt-badge-sm" style={{ width: 13, height: 13, fontSize: 9 }}>
                          P
                        </span>
                        <span>
                          第 {b._meta.selectionPayload.page_index + 1} 页 ·{' '}
                          {b._meta.selectionPayload.shape_ids.length} 个元素
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div>{turn.text}</div>
              </div>
            ) : (
              <div key={turn.id} className="dsh-msg-assistant">
                <div style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</div>
                {turn.aiEditResult?.edit_id && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="ppt-hud-btn"
                      onClick={async () => {
                        if (!activeDeck) return;
                        try {
                          await host.executeTool('slide_undo_ai_edit', {
                            file_id: activeDeck.file_id,
                            edit_id: turn.aiEditResult?.edit_id,
                          });
                          host.showToast('已撤销该次 AI 精准修改');
                        } catch (err) {
                          host.showToast(
                            err instanceof Error ? err.message : '撤销失败',
                          );
                        }
                      }}
                    >
                      <RotateCcw size={12} /> 撤销此次 AI 修改
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        {/* 底部对话输入区 (Composer) */}
        <div className="dsh-composer-wrap">
          {/* 快捷动作条（当存在选区芯片时呈现） */}
          {host.selectionBus.getBlocks().length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {PPT_QUICK_ACTIONS.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  className="ppt-hud-btn"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => void handleSubmitPrompt(act.prompt)}
                >
                  <Sparkles size={11} color="#2563eb" />
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="dsh-composer-box">
            {/* 入口 3：通过 conversation.composer.context Slot 渲染选区芯片条 */}
            {host.renderSlot('conversation.composer.context', {
              sessionId: 'default',
              onFocusSelection: (target: SelectionFocusTarget) =>
                host.focusSelectionTarget(target),
              onCopyToast: (msg: string) => host.showToast(msg),
            })}

            <textarea
              className="dsh-composer-textarea"
              placeholder="今天帮你做些什么？@ 添加上下文，/ 调用技能与指令"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmitPrompt(composerText);
                }
              }}
            />

            <div className="dsh-composer-footer">
              <div className="dsh-composer-left">
                <button
                  type="button"
                  className="dsh-icon-btn"
                  title="添加文件上下文"
                  onClick={() => host.showToast(`选区协议就绪: ${SELECTION_URI_SCHEME}`)}
                >
                  <Plus size={15} />
                </button>
                <button type="button" className="dsh-pill-control">
                  <CheckCircle2 size={13} />
                  <span>默认权限</span>
                  <ChevronDown size={11} />
                </button>
                <span
                  title="PPT Studio 技能已激活"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #2563eb, #38e8d4)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  P
                </span>
              </div>

              <div className="dsh-composer-right">
                <button type="button" className="dsh-pill-control">
                  <span>DeepSeek-V3</span>
                  <ChevronDown size={11} />
                </button>
                <button type="button" className="dsh-icon-btn" title="语音输入">
                  <Mic size={15} />
                </button>
                <button
                  type="button"
                  className={`dsh-send-btn ${
                    composerText.trim() || host.selectionBus.getBlocks().length > 0
                      ? 'is-ready'
                      : ''
                  }`}
                  aria-label="发送"
                  onClick={() => void handleSubmitPrompt(composerText)}
                >
                  <ArrowUp size={15} />
                </button>
              </div>
            </div>
          </div>

          <div className="dsh-disclaimer">内容由 AI 生成，请核实重要信息</div>
        </div>
      </main>

      {/* ==================== 右栏：DSH sidebar.right.pane.tab 槽位 ==================== */}
      {state.rightSidebarOpen && (
        <section className="dsh-right-pane" aria-label="右侧 PPT 工作区">
          {host.renderSlot('sidebar.right.pane.tab', {
            activeDeckId: state.activeDeckId,
          })}
        </section>
      )}

      {/* 所有产物抽屉弹窗 */}
      {allArtifactsOpen && (
        <div
          className="ppt-modal-backdrop"
          onClick={() => setAllArtifactsOpen(false)}
          role="dialog"
          aria-label="所有演示文稿产物"
        >
          <div className="ppt-modal-card" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="ppt-modal-header">
              <span>所有演示文稿产物 ({state.decks.length})</span>
              <button
                type="button"
                className="dsh-icon-btn"
                onClick={() => setAllArtifactsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="ppt-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {state.decks.map((d) => (
                <div
                  key={d.file_id}
                  className="dsh-artifact-card"
                  style={{ margin: 0 }}
                  onClick={() => {
                    host.clientCtx.bridge?.setActiveDeckId(d.file_id);
                    setAllArtifactsOpen(false);
                  }}
                >
                  <div className="dsh-ppt-badge-lg">P</div>
                  <div className="dsh-artifact-info">
                    <div className="dsh-artifact-name">{d.file_name}</div>
                    <div className="dsh-artifact-meta">
                      {d.slides.length} 页 · v{d.version} · {d.file_path}
                    </div>
                  </div>
                  <button type="button" className="ppt-hud-btn primary">
                    打开编辑
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 独立 1440×900 Office 预览窗口模态 */}
      {standaloneModalOpen && (
        <div
          className="ppt-modal-backdrop"
          style={{ padding: 14 }}
          onClick={() => setStandaloneModalOpen(false)}
        >
          <div
            className="ppt-modal-card"
            style={{ width: '96vw', height: '94vh', maxWidth: 1440, maxHeight: 900 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              {host.renderSlot('sidebar.right.pane.tab', {
                activeDeckId: state.activeDeckId,
              })}
            </div>
          </div>
        </div>
      )}

      {state.toastMessage && <div className="ppt-toast">{state.toastMessage}</div>}
    </div>
  );
};
