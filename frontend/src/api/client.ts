import axios from 'axios';

const API_BASE_URL = 'http://localhost:4000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const chatAPI = {
  sendMessage: async (message: string, apiKey: string, sessionId?: string, format: 'drawio' | 'png' = 'drawio') => {
    const response = await apiClient.post('/chat', {
      message,
      apiKey,
      sessionId,
      format
    });
    return response.data;
  }
};

export const statusAPI = {
  getMCPStatus: async () => {
    const response = await apiClient.get('/status/mcp');
    return response.data;
  },

  getHealth: async () => {
    const response = await apiClient.get('/health');
    return response.data;
  }
};
