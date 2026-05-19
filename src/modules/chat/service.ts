import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { notifyEmployee } from '../../services/notify';

export const ChatService = {
  toObjectId(id: any): ObjectId | null {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
    return null;
  },

  async populateConversation(id: ObjectId) {
    const rows = await collections.conversations().aggregate([
      { $match: { _id: id } },
      { $lookup: { from: 'employees', localField: 'participants', foreignField: '_id', as: '_participants' } },
      { $lookup: { from: 'employees', localField: 'lastMessage.sender', foreignField: '_id', as: '_lastSender' } },
      { $lookup: { from: 'employees', localField: 'admin', foreignField: '_id', as: '_admin' } },
    ]).toArray();
    if (rows.length === 0) return null;
    const c: any = rows[0];

    const pickEmp = (e: any) => e ? { _id: e._id, name: e.name, empId: e.empId, avatar: e.avatar, employmentStatus: e.employmentStatus, isActive: e.isActive } : null;

    c.participants = (c.participants || []).map((id: ObjectId) => pickEmp(c._participants.find((p: any) => p._id.equals(id)))).filter(Boolean);
    if (c.lastMessage?.sender) {
      const s = c._lastSender.find((p: any) => p._id.equals(c.lastMessage.sender));
      if (s) c.lastMessage.sender = { _id: s._id, name: s.name };
    }
    if (c.admin) {
      const a = c._admin.find((p: any) => p._id.equals(c.admin));
      if (a) c.admin = { _id: a._id, name: a.name, empId: a.empId };
    }
    delete c._participants; delete c._lastSender; delete c._admin;
    return c;
  },

  async populateMessage(id: ObjectId, opts: { includeReactions?: boolean; includeReadBy?: boolean; includeReplyTo?: boolean; includePinnedBy?: boolean; includeConversation?: boolean } = {}) {
    const stages: any[] = [
      { $match: { _id: id } },
      { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
    ];
    if (opts.includeReplyTo) stages.push({ $lookup: { from: 'messages', localField: 'replyTo', foreignField: '_id', as: '_replyTo' } });
    if (opts.includeReactions) stages.push({ $lookup: { from: 'employees', localField: 'reactions.by', foreignField: '_id', as: '_reactionUsers' } });
    if (opts.includeReadBy) stages.push({ $lookup: { from: 'employees', localField: 'readBy', foreignField: '_id', as: '_readByUsers' } });
    if (opts.includePinnedBy) stages.push({ $lookup: { from: 'employees', localField: 'pinnedBy', foreignField: '_id', as: '_pinnedBy' } });
    if (opts.includeConversation) stages.push({ $lookup: { from: 'conversations', localField: 'conversation', foreignField: '_id', as: '_conversation' } });

    const rows = await collections.messages().aggregate(stages).toArray();
    if (rows.length === 0) return null;
    return ChatService.shapeMessage(rows[0], opts);
  },

  shapeMessage(m: any, opts: { includeReactions?: boolean; includeReadBy?: boolean; includeReplyTo?: boolean; includePinnedBy?: boolean; includeConversation?: boolean } = {}) {
    const pickEmp = (e: any) => e ? { _id: e._id, name: e.name, empId: e.empId, avatar: e.avatar } : null;

    if (m._sender?.[0]) m.sender = pickEmp(m._sender[0]);
    if (opts.includeReplyTo && m._replyTo?.[0]) m.replyTo = { _id: m._replyTo[0]._id, text: m._replyTo[0].text, sender: m._replyTo[0].sender };
    if (opts.includeReactions && m._reactionUsers) {
      m.reactions = (m.reactions || []).map((r: any) => ({ ...r, by: pickEmp(m._reactionUsers.find((u: any) => u._id.equals(r.by))) }));
    }
    if (opts.includeReadBy && m._readByUsers) {
      m.readBy = (m.readBy || []).map((id: ObjectId) => pickEmp(m._readByUsers.find((u: any) => u._id.equals(id)))).filter(Boolean);
    }
    if (opts.includePinnedBy && m._pinnedBy?.[0]) m.pinnedBy = { _id: m._pinnedBy[0]._id, name: m._pinnedBy[0].name, empId: m._pinnedBy[0].empId };
    if (opts.includeConversation && m._conversation?.[0]) {
      const c = m._conversation[0];
      m.conversation = { _id: c._id, type: c.type, name: c.name, participants: c.participants };
    }
    delete m._sender; delete m._replyTo; delete m._reactionUsers; delete m._readByUsers; delete m._pinnedBy; delete m._conversation;
    return m;
  },

  async processMentions(messageId: ObjectId, text: string, conversation: any, senderEmpId: ObjectId) {
    if (!text) return;
    const mentionedNames = [...text.matchAll(/@([\w][^\s@]*(?:\s[\w][^\s@]*)*)/g)].map(m => m[1].trim());
    if (mentionedNames.length === 0) return;

    const escapedNames = mentionedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mentioned = await collections.employees().find({
      _id: { $in: conversation.participants || [] },
      name: { $in: escapedNames.map(n => new RegExp(`^${n}$`, 'i')) as any },
    }, { projection: { _id: 1, name: 1 } }).toArray();

    if (mentioned.length === 0) return;
    await collections.messages().updateOne({ _id: messageId }, { $set: { mentions: mentioned.map(e => e._id) } });

    const senderEmp = await collections.employees().findOne({ _id: senderEmpId }, { projection: { name: 1 } });
    for (const emp of mentioned) {
      if (!emp._id.equals(senderEmpId)) {
        await notifyEmployee(emp._id, {
          type: 'chat',
          title: `${senderEmp?.name || 'Someone'} mentioned you`,
          body: text.slice(0, 80),
          link: '/chat',
        }).catch(() => {});
      }
    }
  },
};
