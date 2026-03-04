export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'authfail'
  | 'disconnecting'
  | 'reconnecting'
  | 'error'
  | 'connfail';

export interface XMPPConfig {
  jid: string;
  password: string;
  websocketUrl?: string;
}
