import { createResource, For, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { getAllBooks, type Book } from '../services/db';

interface Props {
  onSelect: (book: Book) => void;
  onClose: () => void;
}

export const LibraryModal: Component<Props> = (props) => {
  const [books] = createResource(getAllBooks);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      'justify-content': 'center',
      'align-items': 'center',
      'z-index': 1000,
    }} onClick={props.onClose}>
      <div style={{
        background: '#252526',
        border: '1px solid #3d3d3d',
        'border-radius': '12px',
        padding: '22px',
        width: 'min(900px, calc(100vw - 48px))',
        'max-height': '84vh',
        display: 'flex',
        'flex-direction': 'column',
        'box-shadow': '0 20px 60px rgba(0,0,0,0.45)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '18px', gap: '16px' }}>
          <div>
            <h2 style={{ color: '#fff', margin: 0, 'font-size': '20px', 'font-weight': 650 }}>Library</h2>
            <div style={{ color: '#888', 'font-size': '12px', 'margin-top': '3px' }}>Choose a saved PDF to continue reading</div>
          </div>

          <button
            onClick={props.onClose}
            style={{ padding: '7px 12px', 'flex-shrink': 0 }}
          >
            Close
          </button>
        </div>

        <Show when={!books.loading} fallback={<div style={{ color: '#888' }}>Loading…</div>}>
          <Show when={(books() ?? []).length > 0} fallback={
            <div style={{ color: '#666', padding: '42px', 'text-align': 'center', border: '1px dashed #3d3d3d', 'border-radius': '10px' }}>No books saved yet.</div>
          }>
            <div style={{
              display: 'grid',
              'grid-template-columns': 'repeat(auto-fill, minmax(132px, 1fr))',
              gap: '18px',
              overflow: 'auto',
              padding: '2px 4px 4px 2px',
            }}>
              <For each={books()}>
                {(book) => (
                  <button
                    onClick={() => props.onSelect(book)}
                    title={book.title}
                    style={{
                      display: 'flex',
                      'flex-direction': 'column',
                      'align-items': 'center',
                      gap: '10px',
                      padding: '16px 12px 14px',
                      'min-height': '190px',
                      background: book.fileHandle ? '#2d2d30' : '#262626',
                      border: '1px solid #3d3d3d',
                      'border-radius': '10px',
                      cursor: 'pointer',
                      color: book.fileHandle ? '#ddd' : '#777',
                      'text-align': 'center',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = book.fileHandle ? '#353538' : '#303030';
                      e.currentTarget.style.borderColor = '#505050';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = book.fileHandle ? '#2d2d30' : '#262626';
                      e.currentTarget.style.borderColor = '#3d3d3d';
                    }}
                  >
                    <div style={{
                      width: '72px',
                      height: '94px',
                      background: book.fileHandle ? '#e85d4f' : '#555',
                      'border-radius': '6px',
                      position: 'relative',
                      'box-shadow': '0 10px 22px rgba(0,0,0,0.28)',
                      'flex-shrink': 0,
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        width: 0,
                        height: 0,
                        border: '12px solid transparent',
                        'border-top-color': '#f3d4cf',
                        'border-right-color': '#f3d4cf',
                      }} />
                      <div style={{
                        position: 'absolute',
                        left: '9px',
                        right: '9px',
                        bottom: '13px',
                        padding: '4px 0',
                        background: 'rgba(0,0,0,0.24)',
                        color: '#fff',
                        'border-radius': '3px',
                        'font-size': '12px',
                        'font-weight': 700,
                        'letter-spacing': '0.6px',
                      }}>PDF</div>
                    </div>

                    <div style={{
                      width: '100%',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      '-webkit-line-clamp': '2',
                      '-webkit-box-orient': 'vertical',
                      'line-height': 1.25,
                      'font-size': '13px',
                      'font-weight': 500,
                    }}>
                      {book.title}
                    </div>

                    <div style={{ 'font-size': '11px', color: '#888', 'margin-top': 'auto' }}>
                      {book.fileHandle ? `p.${book.lastPage + 1}` : 'reopen needed'}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default LibraryModal;
