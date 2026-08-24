import { For, Show, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js';
import type { Component } from 'solid-js';
import { pdfStore } from '../stores/pdfStore';
import {
  buildTOCTree,
  collectCollapsibleNodeIds,
  findActiveTOCNodeId,
  filterTOCTree,
  type TOCNode,
} from '../utils/tocTree';

const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const SIDEBAR_WIDTH_STORAGE_KEY = 'pdfest_sidebar_width';

function getStoredSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

interface Props {
  onSelectItem: (pageNum: number, y?: number) => void;
  variant?: 'desktop' | 'drawer';
  open?: boolean;
  onClose?: () => void;
}

interface TOCNodeItemProps {
  node: TOCNode;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string, e: MouseEvent) => void;
  onSelect: (pageNum: number, y?: number) => void;
  activeId: string | null;
  matchingIds: Set<string>;
  searchQuery: string;
}

const TOCNodeItem: Component<TOCNodeItemProps> = (props) => {
  const hasChildren = () => props.node.children.length > 0;
  const expanded = () => props.isExpanded(props.node.id);
  const isActive = () => props.activeId === props.node.id;

  return (
    <div class="toc-tree-node">
      <div
        class={`toc-item ${isActive() ? 'toc-item--active' : ''}`}
        onClick={() => props.onSelect(props.node.pageNum, props.node.y)}
      >
        <Show
          when={hasChildren()}
          fallback={<span class="toc-chevron-spacer" />}
        >
          <button
            type="button"
            class={`toc-chevron ${expanded() ? 'toc-chevron--expanded' : ''}`}
            onClick={(e) => props.onToggle(props.node.id, e)}
            title={expanded() ? 'Collapse section' : 'Expand section'}
            aria-label={expanded() ? 'Collapse section' : 'Expand section'}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </Show>

        <span class="toc-title" title={props.node.title}>
          {props.node.title || `Page ${props.node.pageNum + 1}`}
        </span>

        <span class="toc-page" title={`Page ${props.node.pageNum + 1}`}>
          {props.node.pageNum + 1}
        </span>
      </div>

      <Show when={hasChildren() && expanded()}>
        <div class="toc-children">
          <For each={props.node.children}>
            {(child) => (
              <TOCNodeItem
                node={child}
                isExpanded={props.isExpanded}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
                activeId={props.activeId}
                matchingIds={props.matchingIds}
                searchQuery={props.searchQuery}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export const Sidebar: Component<Props> = (props) => {
  const isDrawer = () => props.variant === 'drawer';
  const isVisible = () => isDrawer() ? props.open === true : pdfStore.sidebarVisible();

  // Sidebar width state
  const [sidebarWidth, setSidebarWidth] = createSignal(getStoredSidebarWidth());
  const [isResizing, setIsResizing] = createSignal(false);

  // TOC search state
  const [searchQuery, setSearchQuery] = createSignal('');

  // Expand / collapse state
  const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(new Set());

  // Build hierarchical tree from flat TOC items
  const fullTree = createMemo(() => buildTOCTree(pdfStore.toc()));

  // Auto-expand all collapsible nodes when a new book/TOC is loaded
  createEffect(
    on(
      () => pdfStore.toc(),
      (items) => {
        const tree = buildTOCTree(items);
        const collapsibleIds = collectCollapsibleNodeIds(tree);
        setExpandedNodes(collapsibleIds);
        setSearchQuery('');
      }
    )
  );

  // Filter tree based on search query
  const filteredData = createMemo(() => filterTOCTree(fullTree(), searchQuery()));
  const displayTree = () => filteredData().filtered;
  const matchingIds = () => filteredData().matchingIds;

  // Active TOC node for current page
  const activeNodeId = createMemo(() => findActiveTOCNodeId(fullTree(), pdfStore.currentPage()));

  // Check if a node is expanded (if searching, matching nodes are forced open)
  const isNodeExpanded = (id: string): boolean => {
    if (searchQuery().trim().length > 0) {
      return true;
    }
    return expandedNodes().has(id);
  };

  // Toggle single node expansion
  const toggleNode = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle expand all / collapse all
  const allCollapsibleIds = createMemo(() => collectCollapsibleNodeIds(fullTree()));
  const areAllExpanded = createMemo(() => {
    const all = allCollapsibleIds();
    if (all.size === 0) return true;
    const current = expandedNodes();
    for (const id of all) {
      if (!current.has(id)) return false;
    }
    return true;
  });

  const toggleExpandCollapseAll = () => {
    if (areAllExpanded()) {
      setExpandedNodes(new Set<string>());
    } else {
      setExpandedNodes(allCollapsibleIds());
    }
  };

  // Handle select item
  const handleSelectItem = (pageNum: number, y?: number) => {
    props.onSelectItem(pageNum, y);
    if (isDrawer()) {
      props.onClose?.();
    }
  };

  // Resize handler for desktop sidebar
  const handleResizePointerDown = (e: PointerEvent) => {
    if (isDrawer()) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = sidebarWidth();

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const maxWidth = Math.min(window.innerWidth * 0.6, 750);
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onPointerMove as EventListener);
      target.removeEventListener('pointerup', onPointerUp as EventListener);
      target.removeEventListener('pointercancel', onPointerUp as EventListener);
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, sidebarWidth().toString());
      } catch {}
    };

    target.addEventListener('pointermove', onPointerMove as EventListener);
    target.addEventListener('pointerup', onPointerUp as EventListener);
    target.addEventListener('pointercancel', onPointerUp as EventListener);
  };

  const handleResetWidth = () => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH.toString());
    } catch {}
  };

  onCleanup(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  return (
    <Show when={isVisible()}>
      <aside
        class={isDrawer() ? 'sidebar sidebar--drawer' : `sidebar ${isResizing() ? 'sidebar--resizing' : ''}`}
        style={!isDrawer() ? { width: `${sidebarWidth()}px` } : undefined}
      >
        <div class="sidebar__header">
          <div class="sidebar__title-group">
            <h3>Contents</h3>
            <Show when={pdfStore.toc().length > 0}>
              <span class="sidebar__count">{pdfStore.toc().length}</span>
            </Show>
          </div>

          <div class="sidebar__actions">
            <Show when={allCollapsibleIds().size > 0}>
              <button
                type="button"
                class="sidebar__action-btn"
                onClick={toggleExpandCollapseAll}
                title={areAllExpanded() ? 'Collapse all sections' : 'Expand all sections'}
                aria-label={areAllExpanded() ? 'Collapse all sections' : 'Expand all sections'}
              >
                <Show
                  when={areAllExpanded()}
                  fallback={
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="7 13 12 18 17 13" />
                      <polyline points="7 6 12 11 17 6" />
                    </svg>
                  }
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="17 11 12 6 7 11" />
                    <polyline points="17 18 12 13 7 18" />
                  </svg>
                </Show>
              </button>
            </Show>

            <Show when={isDrawer()}>
              <button type="button" class="sidebar__close-btn" onClick={props.onClose} aria-label="Close table of contents">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Show>
          </div>
        </div>

        <Show when={pdfStore.toc().length > 5}>
          <div class="sidebar__search-bar">
            <div class="sidebar__search-input-wrapper">
              <svg class="sidebar__search-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                class="sidebar__search-input"
                placeholder="Filter table of contents..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
              <Show when={searchQuery().length > 0}>
                <button
                  type="button"
                  class="sidebar__search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear filter"
                >
                  ✕
                </button>
              </Show>
            </div>
          </div>
        </Show>

        <div class="sidebar__toc-list">
          <Show
            when={displayTree().length > 0}
            fallback={
              <div class="sidebar__empty">
                <Show when={searchQuery().length > 0} fallback="No table of contents available">
                  No matching chapters found
                </Show>
              </div>
            }
          >
            <div class="sidebar__tree">
              <For each={displayTree()}>
                {(node) => (
                  <TOCNodeItem
                    node={node}
                    isExpanded={isNodeExpanded}
                    onToggle={toggleNode}
                    onSelect={handleSelectItem}
                    activeId={activeNodeId()}
                    matchingIds={matchingIds()}
                    searchQuery={searchQuery()}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={!isDrawer()}>
          <div
            class="sidebar__resizer"
            onPointerDown={handleResizePointerDown}
            onDblClick={handleResetWidth}
            title="Drag to resize sidebar • Double-click to reset"
          >
            <div class="sidebar__resizer-handle" />
          </div>
        </Show>
      </aside>
    </Show>
  );
};

export default Sidebar;
