import { api } from './apiClient';
import type { ApiResponse } from '@/types/api';
import type { Conversation, ConversationDetail } from '@/types/playground';

/** Query-history endpoints. */
export const ConversationAPI = {
  async list(): Promise<Conversation[]> {
    const { data } = await api.get<ApiResponse<{ conversations: Conversation[] }>>('/conversations');
    return data.data.conversations;
  },

  async get(id: string): Promise<ConversationDetail> {
    const { data } = await api.get<ApiResponse<{ conversation: ConversationDetail }>>(
      `/conversations/${id}`
    );
    return data.data.conversation;
  },

  async rename(id: string, title: string): Promise<Conversation> {
    const { data } = await api.patch<ApiResponse<{ conversation: Conversation }>>(
      `/conversations/${id}`,
      { title }
    );
    return data.data.conversation;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/conversations/${id}`);
  },
};

export default ConversationAPI;
