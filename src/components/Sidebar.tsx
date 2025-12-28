import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { pdfStore } from '../stores/pdfStore';
import type { TOCItem } from '../services/pdfService';

interface Props {
  onSelectItem: (pageNum: number, y?: number) => void;
}

export const Sidebar: Component<Props> = (props) => {
  return (
    <Show when={pdfStore.sidebarVisible()}>
      <div class="sidebar" style={{
        width: '250px',
        background: '#252526',
        'border-right': '1px solid #3d3d3d',
        overflow: 'auto',
        'flex-shrink': 0
      }}>
        <div style={{ padding: '12px', 'border-bottom': '1px solid #3d3d3d' }}>
          <h3 style={{ margin: 0, color: '#fff', 'font-size': '14px' }}>Table of Contents</h3>
        </div>
        
        <div style={{ padding: '8px' }}>
          <For each={pdfStore.toc()}>
            {(item) => (
              <div 
                onClick={() => props.onSelectItem(item.pageNum, item.y)}
                style={{
                  padding: '8px 12px',
                  'padding-left': `${12 + item.level * 16}px`,
                  color: '#ccc',
                  cursor: 'pointer',
                  'font-size': '13px',
                  'border-radius': '4px',
                  'white-space': 'nowrap',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#3d3d3d'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {item.title}
              </div>
            )}
          </For>
          
          <Show when={pdfStore.toc().length === 0}>
            <div style={{ color: '#666', padding: '20px', 'text-align': 'center', 'font-size': '13px' }}>
              No table of contents
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default Sidebar;
