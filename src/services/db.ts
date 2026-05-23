import Dexie, { type EntityTable } from 'dexie';

// Book record stored in IndexedDB
export interface StoredPDFFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export interface Book {
  id?: number;
  path: string;  // For local files, we'll use a unique identifier
  title: string;
  totalPages: number;
  lastPage: number;
  lastPageOffsetY?: number;
  lastSentence: number;
  zoomLevel: number;
  headerMargin: number;
  footerMargin: number;
  columnMode: number; // 1 = single, 2 = two-column
  lastOpened: number; // timestamp
  fileHandle?: StoredPDFFileHandle;
  thumbnailBlob?: Blob;
}

// Global settings
export interface Setting {
  key: string;
  value: string;
}

// Database class
class PDFestDB extends Dexie {
  books!: EntityTable<Book, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor() {
    super('pdfest');
    
    this.version(1).stores({
      books: '++id, path, title, lastOpened',
      settings: 'key'
    });
  }
}

export const db = new PDFestDB();

// Helper functions
export async function addBook(book: Omit<Book, 'id'>): Promise<number> {
  return await db.books.add(book as Book) as number;
}

export async function updateBook(id: number, updates: Partial<Book>): Promise<void> {
  await db.books.update(id, { ...updates, lastOpened: Date.now() });
}

export async function getBookByPath(path: string): Promise<Book | undefined> {
  return await db.books.where('path').equals(path).first();
}

export async function getAllBooks(): Promise<Book[]> {
  return await db.books.orderBy('lastOpened').reverse().toArray();
}

export async function getMostRecentlyOpenedBook(): Promise<Book | undefined> {
  return await db.books.orderBy('lastOpened').reverse().first();
}

export async function deleteBook(id: number): Promise<void> {
  await db.books.delete(id);
}

export async function removeLegacyPdfBlobs(): Promise<void> {
  await db.books.toCollection().modify((book: Book & { pdfBlob?: Blob }) => {
    delete book.pdfBlob;
  });
}

export async function getSetting(key: string, defaultValue: string = ''): Promise<string> {
  const setting = await db.settings.get(key);
  return setting?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}
