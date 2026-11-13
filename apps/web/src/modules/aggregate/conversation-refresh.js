const LIST_EVENTS = new Set([
  'message.created',
  'message.updated',
  'conversation.synced',
  'conversation.created',
  'conversation.updated',
  'conversation.deleted',
  'conversation.read-all'
]);

function eventAccountId(message) {
  return String(message?.account
    || message?.payload?.accountId
    || message?.payload?.account
    || message?.payload?.message?.account
    || message?.payload?.conversation?.account
    || '').trim();
}

export function createConversationRefreshScheduler({ getActiveAccount, onRefresh, delayMs = 250, maxWaitMs = 1000 }) {
  let timer = null;
  let maxTimer = null;
  let pendingActiveMessages = false;
  let pendingConversationId = '';
  let pendingListRefresh = false;
  let disposed = false;

  const flush = () => {
    clearTimeout(timer);
    clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
    if (disposed || !pendingListRefresh) return;
    const update = { refreshActiveMessages: pendingActiveMessages, conversationId: pendingConversationId };
    pendingActiveMessages = false;
    pendingConversationId = '';
    pendingListRefresh = false;
    void onRefresh(update);
  };

  return {
    schedule(message, activeConversationId = '') {
      if (disposed || !LIST_EVENTS.has(message?.event)) return;
      const accountId = eventAccountId(message);
      if (accountId && accountId !== String(getActiveAccount() || '')) return;
      pendingListRefresh = true;

      const conversationId = String(message?.payload?.message?.conversation
        || message?.payload?.conversation?.id
        || message?.payload?.id
        || '').trim();
      // A periodic sync also emits this event when nothing changed. The
      // initial/manual sync has its own bounded poll, and actual new rows emit
      // message.created/conversation.created, so do not reload the full list
      // for every heartbeat sync.
      const isSync = false;
      const isActiveMessage = (message.event === 'message.created' || message.event === 'message.updated')
        && conversationId && conversationId === String(activeConversationId || '');
      pendingActiveMessages ||= isSync || isActiveMessage;
      if (isActiveMessage) pendingConversationId = conversationId;

      if (!timer) timer = setTimeout(flush, delayMs);
      if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(maxTimer);
      timer = null;
      maxTimer = null;
    }
  };
}
