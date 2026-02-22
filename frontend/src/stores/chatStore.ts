import { create } from 'zustand';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatState {
  messages: Message[];
  sessionId: string | null;
  isGenerating: boolean;
  error: string | null;
  addMessage: (message: Message) => void;
  setSessionId: (id: string) => void;
  setGenerating: (generating: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionId: null,
  isGenerating: false,
  error: null,
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),
  setSessionId: (id) => set({ sessionId: id }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [], sessionId: null })
}));
