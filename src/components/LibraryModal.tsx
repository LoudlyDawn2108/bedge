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
    <div class="library-modal" onClick={props.onClose}>
      <div class="library-modal__panel" onClick={e => e.stopPropagation()}>
        <div class="library-modal__header">
          <div>
            <h2>Library</h2>
            <div>Choose a saved PDF to continue reading</div>
          </div>

          <button onClick={props.onClose}>Close</button>
        </div>

        <Show when={!books.loading} fallback={<div style={{ color: '#888' }}>Loading…</div>}>
          <Show when={(books() ?? []).length > 0} fallback={
            <div class="library-modal__empty">No books saved yet.</div>
          }>
            <div class="library-modal__grid">
              <For each={books()}>
                {(book) => (
                  <button
                    class={book.fileHandle ? 'library-book' : 'library-book library-book--stale'}
                    onClick={() => props.onSelect(book)}
                    title={book.title}
                  >
                    <div class="library-book__cover">
                      <div class="library-book__fold" />
                      <div class="library-book__badge">PDF</div>
                    </div>

                    <div class="library-book__title">
                      {book.title}
                    </div>

                    <div class="library-book__meta">
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
