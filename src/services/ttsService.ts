// Edge TTS Service using @andresaya/edge-tts
// High-quality Microsoft neural voices via Edge TTS

import { EdgeTTS } from '@andresaya/edge-tts';

export interface Voice {
  name: string;
  shortName: string;
  lang: string;
  gender: 'Male' | 'Female';
}

export interface TTSContext {
  documentKey: string;
  layoutKey: string;
}

export interface TTSRequest {
  pageNum: number;
  sentenceIndex: number;
  text: string;
}

// Default voice - high quality neural voice
const DEFAULT_VOICE = 'en-US-AndrewMultilingualNeural';
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 12 * 1024 * 1024;

interface CachedAudioEntry {
  url: string;
  bytes: number;
  lastUsedAt: number;
  contextVersion: number;
}

interface EdgeVoiceRecord {
  FriendlyName?: string;
  Name: string;
  ShortName: string;
  Locale: string;
  Gender: 'Male' | 'Female';
}

class TTSService {
  private currentVoice: string = DEFAULT_VOICE;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioCleanup: (() => void) | null = null;
  private currentPlaybackResolve: (() => void) | null = null;
  private currentPlaybackKey: string | null = null;
  private voicesCache: Voice[] | null = null;
  private currentContext: TTSContext | null = null;
  private contextVersion = 0;
  private playbackToken = 0;
  private audioCache = new Map<string, CachedAudioEntry>();
  private audioCacheBytes = 0;
  private inFlight = new Map<string, Promise<CachedAudioEntry | null>>();
  private wantedPrefetchKeys: string[] = [];
  private wantedPrefetchRequests = new Map<string, TTSRequest>();
  private prefetchWorker: Promise<void> | null = null;
  
  async getVoices(): Promise<Voice[]> {
    if (this.voicesCache) return this.voicesCache;
    
    try {
      // EdgeTTS.getVoices() returns list of available voices
      const tts = new EdgeTTS();
      const voices = await tts.getVoices() as EdgeVoiceRecord[];
      this.voicesCache = voices.map(v => ({
        name: v.FriendlyName || v.Name,
        shortName: v.ShortName,
        lang: v.Locale,
        gender: v.Gender
      }));
      return this.voicesCache;
    } catch (e) {
      console.error('Failed to fetch voices:', e);
      return [];
    }
  }
  
  async getVoicesFiltered(lang?: string, gender?: 'Male' | 'Female'): Promise<Voice[]> {
    const voices = await this.getVoices();
    return voices.filter(v => {
      if (lang && !v.lang.startsWith(lang)) return false;
      if (gender && v.gender !== gender) return false;
      return true;
    });
  }

  setContext(context: TTSContext): void {
    const hasChanged = this.currentContext?.documentKey !== context.documentKey
      || this.currentContext?.layoutKey !== context.layoutKey;

    if (!hasChanged) return;

    this.stop();
    this.contextVersion += 1;
    this.currentContext = context;
    this.clearReadyCache();
    this.inFlight.clear();
  }
  
  setVoice(shortName: string): void {
    if (shortName === this.currentVoice) return;

    this.stop();
    this.currentVoice = shortName;
    this.contextVersion += 1;
    this.clearReadyCache();
    this.inFlight.clear();
  }
  
  getVoice(): string {
    return this.currentVoice;
  }
  
  async prepare(request: TTSRequest): Promise<void> {
    await this.ensurePrepared(request, this.contextVersion);
  }

  async play(request: TTSRequest): Promise<void> {
    if (!request.text.trim()) return;

    if (this.currentAudio) {
      this.stop();
    }

    const playbackToken = this.playbackToken;
    const contextVersion = this.contextVersion;
    const cacheKey = this.getCacheKey(request);
    const entry = await this.ensurePrepared(request, contextVersion);

    if (!entry) return;
    if (playbackToken !== this.playbackToken || contextVersion !== this.contextVersion) return;

    await this.playEntry(cacheKey, entry, playbackToken, contextVersion);
  }

  async speak(text: string): Promise<void> {
    await this.play({ pageNum: -1, sentenceIndex: -1, text });
  }

  primeWindow(requests: TTSRequest[]): void {
    const nextKeys: string[] = [];
    const nextRequests = new Map<string, TTSRequest>();

    for (const request of requests) {
      if (!request.text.trim()) continue;
      const key = this.getCacheKey(request);
      if (nextRequests.has(key)) continue;
      nextRequests.set(key, request);
      nextKeys.push(key);
    }

    this.wantedPrefetchKeys = nextKeys;
    this.wantedPrefetchRequests = nextRequests;

    if (nextKeys.length === 0 || this.prefetchWorker) return;
    this.prefetchWorker = this.runPrefetchWorker();
  }
  
  stop(): void {
    this.playbackToken += 1;
    this.wantedPrefetchKeys = [];
    this.wantedPrefetchRequests.clear();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudioCleanup?.();
    }

    const resolvePlayback = this.currentPlaybackResolve;
    this.currentPlaybackResolve = null;
    resolvePlayback?.();
  }

  clear(): void {
    this.stop();
    this.contextVersion += 1;
    this.currentContext = null;
    this.clearReadyCache();
    this.inFlight.clear();
  }
  
  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
  }
  
  resume(): void {
    if (this.currentAudio) {
      this.currentAudio.play();
    }
  }
  
  isPlaying(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused;
  }
  
  isPaused(): boolean {
    return this.currentAudio !== null && this.currentAudio.paused;
  }

  private getCacheKey(request: TTSRequest): string {
    return JSON.stringify([
      this.currentContext?.documentKey ?? '__global__',
      this.currentContext?.layoutKey ?? '__default__',
      this.currentVoice,
      request.pageNum,
      request.sentenceIndex,
      request.text,
    ]);
  }

  private async ensurePrepared(request: TTSRequest, contextVersion: number): Promise<CachedAudioEntry | null> {
    const cacheKey = this.getCacheKey(request);
    const cachedEntry = this.audioCache.get(cacheKey);
    if (cachedEntry) {
      this.touchEntry(cacheKey, cachedEntry);
      return cachedEntry;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const voice = this.currentVoice;
    const task = this.synthesizeRequest(request, cacheKey, voice, contextVersion)
      .finally(() => {
        if (this.inFlight.get(cacheKey) === task) {
          this.inFlight.delete(cacheKey);
        }
      });

    this.inFlight.set(cacheKey, task);
    return task;
  }

  private async synthesizeRequest(
    request: TTSRequest,
    cacheKey: string,
    voice: string,
    contextVersion: number,
  ): Promise<CachedAudioEntry | null> {
    if (!request.text.trim()) return null;

    const tts = new EdgeTTS();
    const chunks: Uint8Array[] = [];

    for await (const chunk of tts.synthesizeStream(request.text, voice)) {
      if (contextVersion !== this.contextVersion) {
        return null;
      }
      chunks.push(chunk);
    }

    if (contextVersion !== this.contextVersion) {
      return null;
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const audioData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([audioData], { type: 'audio/mp3' });
    const audioUrl = URL.createObjectURL(blob);

    if (contextVersion !== this.contextVersion) {
      URL.revokeObjectURL(audioUrl);
      return null;
    }

    const entry: CachedAudioEntry = {
      url: audioUrl,
      bytes: totalLength,
      lastUsedAt: Date.now(),
      contextVersion,
    };

    this.storeEntry(cacheKey, entry);
    return entry;
  }

  private async playEntry(
    cacheKey: string,
    entry: CachedAudioEntry,
    playbackToken: number,
    contextVersion: number,
  ): Promise<void> {
    this.touchEntry(cacheKey, entry);

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(entry.url);
      let settled = false;

      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        if (this.currentAudioCleanup === cleanup) {
          this.currentAudioCleanup = null;
        }
        if (this.currentPlaybackResolve === resolveCurrentPlayback) {
          this.currentPlaybackResolve = null;
        }
        if (this.currentPlaybackKey === cacheKey) {
          this.currentPlaybackKey = null;
        }
      };

      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };

      const resolveCurrentPlayback = () => finish(resolve);

      this.currentAudio = audio;
      this.currentAudioCleanup = cleanup;
      this.currentPlaybackResolve = resolveCurrentPlayback;
      this.currentPlaybackKey = cacheKey;

      audio.onended = () => finish(resolve);
      audio.onerror = () => finish(() => reject(new Error('Audio playback error')));

      if (playbackToken !== this.playbackToken || contextVersion !== this.contextVersion) {
        resolveCurrentPlayback();
        return;
      }

      void audio.play().catch(err => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      });
    });
  }

  private touchEntry(cacheKey: string, entry: CachedAudioEntry): void {
    entry.lastUsedAt = Date.now();
    this.audioCache.delete(cacheKey);
    this.audioCache.set(cacheKey, entry);
  }

  private storeEntry(cacheKey: string, entry: CachedAudioEntry): void {
    const existing = this.audioCache.get(cacheKey);
    if (existing) {
      this.audioCacheBytes -= existing.bytes;
      URL.revokeObjectURL(existing.url);
      this.audioCache.delete(cacheKey);
    }

    this.audioCache.set(cacheKey, entry);
    this.audioCacheBytes += entry.bytes;
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (
      (this.audioCache.size > MAX_CACHE_ENTRIES || this.audioCacheBytes > MAX_CACHE_BYTES)
      && this.audioCache.size > 0
    ) {
      let evicted = false;

      for (const [cacheKey, entry] of this.audioCache) {
        if (cacheKey === this.currentPlaybackKey) continue;
        this.audioCache.delete(cacheKey);
        this.audioCacheBytes -= entry.bytes;
        URL.revokeObjectURL(entry.url);
        evicted = true;
        break;
      }

      if (!evicted) break;
    }
  }

  private clearReadyCache(): void {
    for (const entry of this.audioCache.values()) {
      URL.revokeObjectURL(entry.url);
    }
    this.audioCache.clear();
    this.audioCacheBytes = 0;
  }

  private async runPrefetchWorker(): Promise<void> {
    try {
      while (this.wantedPrefetchKeys.length > 0) {
        const cacheKey = this.wantedPrefetchKeys[0];
        const request = this.wantedPrefetchRequests.get(cacheKey);

        if (!request) {
          this.wantedPrefetchKeys.shift();
          continue;
        }

        const contextVersion = this.contextVersion;
        await this.ensurePrepared(request, contextVersion);

        this.wantedPrefetchKeys = this.wantedPrefetchKeys.filter(key => key !== cacheKey);
        this.wantedPrefetchRequests.delete(cacheKey);

        if (contextVersion !== this.contextVersion) {
          break;
        }
      }
    } finally {
      this.prefetchWorker = null;
      if (this.wantedPrefetchKeys.length > 0) {
        this.prefetchWorker = this.runPrefetchWorker();
      }
    }
  }
}

export const ttsService = new TTSService();
