import type { Word } from '../pdf/types';

export interface Sentence {
  id: string;
  text: string;
  words: Word[];
  pageNum: number;
}
