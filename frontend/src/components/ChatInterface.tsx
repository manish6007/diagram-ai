import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { chatAPI } from '../api/client';

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [format, setFormat] = useState<'drawio' | 'png'>('drawio');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sessionId, isGenerating, error, addMessage, setSessionId, setGenerating, setError } = useChatStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || !apiKey.trim()) {
      setError('Please enter both message and API key');
      return;
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: input,
      timestamp: new Date()
    };

    addMessage(userMessage);
    setInput('');
    setGenerating(true);
    setError(null);

    try {
      const response = await chatAPI.sendMessage(input, apiKey, sessionId || undefined, format);

      if (response.sessionId && !sessionId) {
        setSessionId(response.sessionId);
      }

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant' as const,
        content: response.response || 'Diagram generated',
        timestamp: new Date()
      };

      addMessage(assistantMessage);
    } catch (err: any) {
      setError(err.response?.data?.details || 'Failed to generate diagram');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-800">DiagramAI</h1>
        <p className="text-sm text-gray-600">Generate diagrams with natural language</p>
      </div>

      {/* API Key and Format Input */}
      <div className="bg-yellow-50 border-b px-6 py-3 flex gap-4 items-center">
        <input
          type="password"
          placeholder="Enter OpenAI API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'drawio' | 'png')}
          className="w-1/3 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="drawio">Interactive Diagram (Draw.io)</option>
          <option value="png">Static Image (PNG)</option>
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-2xl px-4 py-2 rounded-lg ${msg.role === 'user'
                ? 'bg-blue-500 text-white'
                : 'bg-white border text-gray-800'
                }`}
            >
              {msg.content.includes('.png') && msg.role === 'assistant' ? (
                <div className="flex flex-col gap-2">
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {(() => {
                    const match = msg.content.match(/(?:(?:C:)?(?:\/|\\)|\b)[^\s"']+\.png/i);
                    if (match) {
                      const fileName = match[0].split(/[/\\]/).pop();
                      return (
                        <div className="mt-4 border rounded p-2 bg-gray-50 flex flex-col items-center">
                          <img
                            src={`http://localhost:4000/diagrams/${fileName}`}
                            alt="Generated Architecture Diagram"
                            className="max-w-full rounded shadow-sm"
                          />
                          <a
                            href={`http://localhost:4000/diagrams/${fileName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-blue-500 hover:underline mt-2"
                          >
                            Open Full Image
                          </a>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              <span className="text-xs opacity-70 mt-1 block">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-white border px-4 py-2 rounded-lg">
              <p className="text-gray-600">Generating diagram...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-lg">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="bg-white border-t px-6 py-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your diagram (e.g., 'Create AWS 3-tier architecture')"
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isGenerating}
          />
          <button
            type="submit"
            disabled={isGenerating || !input.trim() || !apiKey.trim()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
