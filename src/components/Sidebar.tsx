import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { pdfStore } from '../stores/pdfStore';

interface Props {
  onSelectItem: (pageNum: number, y?: number) => void;
  variant?: 'desktop' | 'drawer';
  open?: boolean;
  onClose?: () => void;
}

export const Sidebar: Component<Props> = (props) => {
  const isDrawer = () => props.variant === 'drawer';
  const isVisible = () => isDrawer() ? props.open === true : pdfStore.sidebarVisible();

  return (
    <Show when={isVisible()}>
      <div class={isDrawer() ? 'sidebar sidebar--drawer' : 'sidebar'}>
        <div class="sidebar__header">
          <h3>Table of Contents</h3>
          <Show when={isDrawer()}>
            <button onClick={props.onClose}>Close</button>
          </Show>
        </div>
        
        <div class="sidebar__toc-list">
          <For each={pdfStore.toc()}>
            {(item) => (
              <div
                class="toc-item"
                onClick={() => {
                  props.onSelectItem(item.pageNum, item.y);
                  if (isDrawer()) props.onClose?.();
                }}
                style={{
                  'padding-left': `${12 + item.level * 16}px`,
                }}
              >
                {item.title}
              </div>
            )}
          </For>
          
          <Show when={pdfStore.toc().length === 0}>
            <div class="sidebar__empty">
              No table of contents
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default Sidebar;
