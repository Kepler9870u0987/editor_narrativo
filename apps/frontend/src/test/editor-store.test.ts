/**
 * Test: Editor Store — pressureLevel, ragChat, modelStatus.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../features/editor/editor-store';

// Mock localStorage for test env
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

describe('Editor Store — new features', () => {
  beforeEach(() => {
    storage.clear();
    // Reset store to initial state
    useEditorStore.setState({
      pressureLevel: 2,
      ragChatMessages: [],
      ragChatOpen: false,
      modelStatus: 'idle',
      modelDownloadProgress: 0,
    });
  });

  describe('pressureLevel', () => {
    it('defaults to 2', () => {
      expect(useEditorStore.getState().pressureLevel).toBe(2);
    });

    it('setPressureLevel updates the level', () => {
      useEditorStore.getState().setPressureLevel(5);
      expect(useEditorStore.getState().pressureLevel).toBe(5);
    });

    it('persists to localStorage', () => {
      useEditorStore.getState().setPressureLevel(4);
      expect(localStorage.getItem('editor-pressure-level')).toBe('4');
    });
  });

  describe('ragChat', () => {
    it('starts with empty messages and closed', () => {
      const state = useEditorStore.getState();
      expect(state.ragChatMessages).toEqual([]);
      expect(state.ragChatOpen).toBe(false);
    });

    it('addRagChatMessage appends message', () => {
      useEditorStore.getState().addRagChatMessage({
        id: '1',
        role: 'user',
        content: 'test',
        citations: [],
      });
      expect(useEditorStore.getState().ragChatMessages).toHaveLength(1);
      expect(useEditorStore.getState().ragChatMessages[0]?.content).toBe('test');
    });

    it('clearRagChatMessages empties array', () => {
      useEditorStore.getState().addRagChatMessage({
        id: '1',
        role: 'user',
        content: 'test',
        citations: [],
      });
      useEditorStore.getState().clearRagChatMessages();
      expect(useEditorStore.getState().ragChatMessages).toEqual([]);
    });

    it('toggleRagChat flips open state', () => {
      expect(useEditorStore.getState().ragChatOpen).toBe(false);
      useEditorStore.getState().toggleRagChat();
      expect(useEditorStore.getState().ragChatOpen).toBe(true);
      useEditorStore.getState().toggleRagChat();
      expect(useEditorStore.getState().ragChatOpen).toBe(false);
    });
  });

  describe('modelStatus', () => {
    it('defaults to idle', () => {
      expect(useEditorStore.getState().modelStatus).toBe('idle');
    });

    it('setModelStatus updates status', () => {
      useEditorStore.getState().setModelStatus('loading');
      expect(useEditorStore.getState().modelStatus).toBe('loading');
    });

    it('setModelDownloadProgress updates progress', () => {
      useEditorStore.getState().setModelDownloadProgress(0.75);
      expect(useEditorStore.getState().modelDownloadProgress).toBe(0.75);
    });
  });
});
