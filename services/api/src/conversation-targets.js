/**
 * Target contracts shared by the server-side conversation adapters.
 * Search results may contain several identifiers, but each transport has a
 * single canonical identifier for creating a direct conversation.
 */

const numericUid = /^\d{1,30}$/;
const secUid = /^[A-Za-z0-9._-]{3,512}$/;

export class ConversationTargetError extends Error {
  constructor(message, { channel = '', code = 'invalid_target' } = {}) {
    super(message);
    this.name = 'ConversationTargetError';
    this.channel = channel;
    this.code = code;
  }
}

export function normalizeTargetInput(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      uid: String(value.uid || '').trim(),
      secUid: String(value.secUid || value.sec_uid || '').trim(),
      douyinId: String(value.douyinId || value.douyin_id || value.uniqueId || value.unique_id || '').trim(),
      name: String(value.name || value.nickname || '').trim().slice(0, 100),
      avatar: String(value.avatar || '').trim().slice(0, 2000),
    };
  }
  const input = String(value || '').trim();
  if (numericUid.test(input)) return { uid: input, secUid: '', douyinId: '', name: '', avatar: '' };
  if (input.startsWith('MS4wLjAB')) return { uid: '', secUid: input, douyinId: '', name: '', avatar: '' };
  return { uid: '', secUid: '', douyinId: input, name: '', avatar: '' };
}

export function normalizeDuoshanTarget(target) {
  const value = normalizeTargetInput(target);
  if (value.secUid && !value.uid) return { ...value, channel: 'duoshan', resolveBySecUid: true };
  if (value.douyinId && !value.uid) return { ...value, channel: 'duoshan', resolveByDouyinId: true };
  if (!numericUid.test(value.uid)) {
    throw new ConversationTargetError('抖音聊天私信必须使用数字 UID；请先搜索并选择目标用户。', {
      channel: 'duoshan', code: 'duoshan_uid_required'
    });
  }
  return { ...value, uid: value.uid, channel: 'duoshan' };
}

export function normalizeCreatorTarget(target) {
  const value = normalizeTargetInput(target);
  if (!secUid.test(value.secUid) || /^\d+$/.test(value.secUid)) {
    throw new ConversationTargetError('创作者中心私信必须使用目标 sec_uid；请先搜索并选择目标用户。', {
      channel: 'creator', code: 'creator_sec_uid_required'
    });
  }
  return { ...value, secUid: value.secUid, channel: 'creator' };
}

export function targetIdentity(target) {
  const value = normalizeTargetInput(target);
  return {
    uid: value.uid,
    sec_uid: value.secUid,
    douyin_id: value.douyinId,
    name: value.name,
    avatar: value.avatar,
  };
}
