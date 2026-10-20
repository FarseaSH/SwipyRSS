export type StreamRequest = {
  streamId: string;
  unreadOnly: boolean;
  continuation?: string;
  limit?: number;
};

export type EntryStateMutation = {
  articleIds: string[];
  read?: boolean;
  starred?: boolean;
  operationId: number;
};

export type MarkStreamReadRequest = {
  streamId: string;
  beforeTimestampUsec: string;
};
