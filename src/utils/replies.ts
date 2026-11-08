/** XEP-0461 reply metadata, keyed by the replying message's stanza id. */

export interface ReplyInfo {
  id: string;
  to: string;
}

const replies = new Map<string, ReplyInfo>();

export function recordReply(msgid: string, id: string, to = ''): void {
  if (msgid && id) replies.set(msgid, { id, to });
}

export function getReply(msgid: string | null | undefined): ReplyInfo | undefined {
  return msgid ? replies.get(msgid) : undefined;
}
