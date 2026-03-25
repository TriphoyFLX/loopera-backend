export interface Chat {
  id: number;
  participant1_id: number;
  participant2_id: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  read_at?: string;
}

export interface ChatWithDetails extends Chat {
  participant1: {
    id: number;
    username: string;
  };
  participant2: {
    id: number;
    username: string;
  };
  last_message?: {
    content: string;
    created_at: string;
    sender_id: number;
  };
  unread_count: number;
}
