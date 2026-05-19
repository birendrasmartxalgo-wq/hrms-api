import { Elysia } from 'elysia';
import { ObjectId } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';
import { putObject, buildUploadKey } from '../../services/s3';
import { ChatSchemas } from './schema';
import { ChatService } from './service';
import { presence } from '../../ws/presence';

const oid = ChatService.toObjectId;
const EDIT_WINDOW_MS = 60 * 60 * 1000;

// Placeholder for WebSocket emit — wired in Phase 10.
function wsEmit(_room: string, _event: string, _payload: any) {
  // TODO Phase 10: route through ws router
}

export const chatController = new Elysia({ prefix: '/chat' })
  .use(authPlugin)
  .guard({ authorize: true as const }, app => app

  // ─── LIST CONVERSATIONS ───────────────────────────────────────────────────
  .get('/', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    if (!empId) { set.status = 400; return { message: 'No employee profile' }; }

    const rows = await collections.conversations().aggregate([
      { $match: { participants: empId, isActive: { $ne: false } } },
      { $lookup: { from: 'employees', localField: 'participants', foreignField: '_id', as: '_participants' } },
      { $lookup: { from: 'employees', localField: 'lastMessage.sender', foreignField: '_id', as: '_lastSender' } },
      { $lookup: { from: 'employees', localField: 'admin', foreignField: '_id', as: '_admin' } },
      { $sort: { 'lastMessage.timestamp': -1 } },
    ]).toArray();

    const result = await Promise.all(rows.map(async (c: any) => {
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

      const unreadCount = await collections.messages().countDocuments({
        conversation: c._id,
        readBy: { $ne: empId } as any,
        sender: { $ne: empId } as any,
      });
      return { ...c, unreadCount };
    }));

    return result;
  })

  // ─── GET/CREATE DIRECT ────────────────────────────────────────────────────
  .post('/direct', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    if (!empId) { set.status = 400; return { message: 'No employee profile' }; }
    const otherId = oid(body.participantId);
    if (!otherId) { set.status = 400; return { message: 'Invalid participantId' }; }
    if (otherId.equals(empId)) { set.status = 400; return { message: 'Cannot create a chat with yourself' }; }

    let conv = await collections.conversations().findOne({
      type: 'direct',
      participants: { $all: [empId, otherId], $size: 2 } as any,
    });

    if (!conv) {
      const newDoc = {
        _id: new ObjectId(),
        type: 'direct' as const,
        participants: [empId, otherId],
        readBy: [
          { participant: empId, lastReadAt: new Date() },
          { participant: otherId, lastReadAt: new Date() },
        ],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      try {
        await collections.conversations().insertOne(newDoc);
        conv = newDoc;
      } catch (e: any) {
        if (e.code === 11000) {
          conv = await collections.conversations().findOne({
            type: 'direct',
            participants: { $all: [empId, otherId], $size: 2 } as any,
          });
        } else throw e;
      }
      set.status = 201;
    }

    return await ChatService.populateConversation(conv!._id);
  }, ChatSchemas.Direct)

  // ─── CREATE GROUP ─────────────────────────────────────────────────────────
  .post('/groups', async ({ user, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    if (!empId) { set.status = 400; return { message: 'No employee profile' }; }

    const incoming = (body.participants || []).map(p => oid(p)).filter((x): x is ObjectId => !!x);
    const set1 = new Map<string, ObjectId>([[empId.toHexString(), empId]]);
    for (const p of incoming) set1.set(p.toHexString(), p);

    const admins = await collections.users().find({ role: 'admin', isActive: true }, { projection: { employee: 1 } }).toArray();
    for (const a of admins) {
      if (a.employee && !set1.has(a.employee.toHexString())) set1.set(a.employee.toHexString(), a.employee);
    }

    const allParticipants = [...set1.values()];
    const now = new Date();
    const convId = new ObjectId();

    await collections.conversations().insertOne({
      _id: convId,
      type: 'group',
      name: body.name,
      description: body.description,
      admin: empId,
      participants: allParticipants,
      readBy: allParticipants.map(p => ({ participant: p, lastReadAt: now })),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const creator = await collections.employees().findOne({ _id: empId }, { projection: { name: 1 } });
    await collections.messages().insertOne({
      _id: new ObjectId(),
      conversation: convId,
      sender: empId,
      text: `${creator?.name || 'Someone'} created the group "${body.name}"`,
      type: 'system',
      readBy: [empId],
      createdAt: now,
      updatedAt: now,
    });

    set.status = 201;
    return await ChatService.populateConversation(convId);
  }, ChatSchemas.CreateGroup)

  // ─── ONLINE USERS ─────────────────────────────────────────────────────────
  .get('/online', async () => {
    const ids = presence.onlineIds()
      .map(id => ChatService.toObjectId(id))
      .filter((x): x is ObjectId => !!x);
    if (ids.length === 0) return [];
    return await collections.employees().find(
      { _id: { $in: ids } } as any,
      { projection: { name: 1, empId: 1, avatar: 1, designation: 1 } },
    ).toArray();
  })

  // ─── SEARCH MESSAGES ──────────────────────────────────────────────────────
  .get('/search', async ({ user, query, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    if (!empId) { set.status = 400; return { message: 'No employee profile' }; }

    const page = Math.max(1, parseInt(query.page || '1'));
    const limit = Math.max(1, parseInt(query.limit || '20'));
    const skip = (page - 1) * limit;
    const q = query.q.trim();
    if (!q) { set.status = 400; return { message: 'Search query is required' }; }

    const userConvs = await collections.conversations().find({ participants: empId } as any, { projection: { _id: 1 } }).toArray();
    const conversationIds = userConvs.map(c => c._id);

    const filter = {
      conversation: { $in: conversationIds },
      text: { $regex: q, $options: 'i' },
      isDeleted: { $ne: true },
    } as any;

    const [rows, total] = await Promise.all([
      collections.messages().aggregate([
        { $match: filter },
        { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
        { $lookup: { from: 'conversations', localField: 'conversation', foreignField: '_id', as: '_conversation' } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]).toArray(),
      collections.messages().countDocuments(filter),
    ]);

    const messages = rows.map(r => ChatService.shapeMessage(r, { includeConversation: true }));
    return { messages, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }, ChatSchemas.Search)

  // ─── STARRED MESSAGES ─────────────────────────────────────────────────────
  .get('/starred', async ({ user, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    if (!empId) { set.status = 400; return { message: 'No employee profile' }; }

    const userConvs = await collections.conversations().find({ participants: empId } as any, { projection: { _id: 1 } }).toArray();
    const ids = userConvs.map(c => c._id);
    const rows = await collections.messages().aggregate([
      { $match: { conversation: { $in: ids }, starredBy: empId, isDeleted: { $ne: true } } },
      { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
      { $lookup: { from: 'conversations', localField: 'conversation', foreignField: '_id', as: '_conversation' } },
      { $sort: { createdAt: -1 } },
    ]).toArray();
    return rows.map(r => ChatService.shapeMessage(r, { includeConversation: true }));
  })

  // ─── GET MEDIA (by conversation) ──────────────────────────────────────────
  .get('/:conversationId/media', async ({ user, params, query, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId, participants: empId } as any);
    if (!conv) { set.status = 404; return { message: 'Conversation not found' }; }

    const filter: any = { conversation: convId, isDeleted: { $ne: true } };
    if (query.type === 'image') filter.type = 'image';
    else if (query.type === 'file') filter.type = 'file';
    else if (query.type === 'link') { filter.type = 'text'; filter.text = { $regex: 'https?://', $options: 'i' }; }

    const rows = await collections.messages().aggregate([
      { $match: filter },
      { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
    ]).toArray();
    const messages = rows.map(r => ChatService.shapeMessage(r));

    const grouped: Record<string, any[]> = {};
    for (const m of messages) {
      const day = new Date(m.createdAt).toISOString().slice(0, 10);
      (grouped[day] ||= []).push(m);
    }
    return grouped;
  }, ChatSchemas.ConversationMedia)

  // ─── PINNED MESSAGES (by conversation) ────────────────────────────────────
  .get('/:conversationId/pinned', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId, participants: empId } as any);
    if (!conv) { set.status = 404; return { message: 'Conversation not found' }; }

    const rows = await collections.messages().aggregate([
      { $match: { conversation: convId, isPinned: true, isDeleted: { $ne: true } } },
      { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
      { $lookup: { from: 'employees', localField: 'pinnedBy', foreignField: '_id', as: '_pinnedBy' } },
      { $sort: { pinnedAt: -1 } },
    ]).toArray();
    return rows.map(r => ChatService.shapeMessage(r, { includePinnedBy: true }));
  })

  // ─── LIST MESSAGES ────────────────────────────────────────────────────────
  .get('/:conversationId/messages', async ({ user, params, query, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId, participants: empId } as any);
    if (!conv) { set.status = 404; return { message: 'Conversation not found' }; }

    const page = Math.max(1, parseInt(query.page || '1'));
    const limit = Math.max(1, parseInt(query.limit || '50'));
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      collections.messages().aggregate([
        { $match: { conversation: convId } },
        { $lookup: { from: 'employees', localField: 'sender', foreignField: '_id', as: '_sender' } },
        { $lookup: { from: 'messages', localField: 'replyTo', foreignField: '_id', as: '_replyTo' } },
        { $lookup: { from: 'employees', localField: 'reactions.by', foreignField: '_id', as: '_reactionUsers' } },
        { $lookup: { from: 'employees', localField: 'readBy', foreignField: '_id', as: '_readByUsers' } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]).toArray(),
      collections.messages().countDocuments({ conversation: convId }),
    ]);

    await collections.messages().updateMany(
      { conversation: convId, readBy: { $ne: empId } as any },
      { $addToSet: { readBy: empId } } as any,
    );
    await collections.conversations().updateOne(
      { _id: convId, 'readBy.participant': empId } as any,
      { $set: { 'readBy.$.lastReadAt': new Date() } },
    );

    const messages = rows.map(r => ChatService.shapeMessage(r, { includeReactions: true, includeReadBy: true, includeReplyTo: true }));
    return { messages, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }, ChatSchemas.ListMessages)

  // ─── SEND MESSAGE ─────────────────────────────────────────────────────────
  .post('/:conversationId/messages', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId, participants: empId } as any);
    if (!conv) { set.status = 404; return { message: 'Conversation not found' }; }

    const messageId = new ObjectId();
    const text = body.text || '';
    const type = body.type || 'text';
    const now = new Date();
    const replyTo = body.replyTo ? oid(body.replyTo) : undefined;

    await collections.messages().insertOne({
      _id: messageId,
      conversation: convId,
      sender: empId,
      text,
      type,
      replyTo: replyTo || undefined,
      file: body.file as any,
      readBy: [empId],
      createdAt: now,
      updatedAt: now,
    });

    await collections.conversations().updateOne({ _id: convId }, {
      $set: {
        lastMessage: {
          text: type === 'file' || type === 'image' ? `Sent a ${type}` : text,
          sender: empId,
          timestamp: now,
          type,
        },
        updatedAt: now,
      },
    });

    if (text) ChatService.processMentions(messageId, text, conv, empId).catch(() => {});

    const populated = await ChatService.populateMessage(messageId, { includeReplyTo: true, includeReadBy: true });
    wsEmit(`conv:${convId.toHexString()}`, 'message:new', populated);

    set.status = 201;
    return populated;
  }, ChatSchemas.SendMessage)

  // ─── FILE UPLOAD ──────────────────────────────────────────────────────────
  .post('/:conversationId/upload', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId, participants: empId } as any);
    if (!conv) { set.status = 403; return { message: 'Not a participant' }; }

    const file = body.file;
    if (!file) { set.status = 400; return { message: 'No file uploaded' }; }

    const messageId = new ObjectId();
    const key = buildUploadKey({
      purpose: 'chat',
      contentType: file.type || 'application/octet-stream',
      filename: file.name,
      conversationId: convId.toHexString(),
      messageId: messageId.toHexString(),
    });
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream');

    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
    const now = new Date();

    await collections.messages().insertOne({
      _id: messageId,
      conversation: convId,
      sender: empId,
      text: file.name,
      type: isImage ? 'image' : 'file',
      file: { fileName: file.name, fileUrl: key, fileSize: file.size, mimeType: file.type },
      readBy: [empId],
      createdAt: now,
      updatedAt: now,
    });

    await collections.conversations().updateOne({ _id: convId }, {
      $set: {
        lastMessage: { text: isImage ? '📷 Image' : `📎 ${file.name}`, sender: empId, timestamp: now, type: isImage ? 'image' : 'file' },
        updatedAt: now,
      },
    });

    const populated = await ChatService.populateMessage(messageId, { includeReadBy: true });
    wsEmit(`conv:${convId.toHexString()}`, 'message:new', populated);

    set.status = 201;
    return populated;
  }, ChatSchemas.UploadFile)

  // ─── UPDATE GROUP ─────────────────────────────────────────────────────────
  .put('/groups/:conversationId', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    if (!empId || !convId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId });
    if (!conv || conv.type !== 'group') { set.status = 404; return { message: 'Group not found' }; }
    if (!conv.admin || !conv.admin.equals(empId)) { set.status = 403; return { message: 'Only the group admin can update group info' }; }

    const update: any = {};
    if (body.name) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    update.updatedAt = new Date();
    await collections.conversations().updateOne({ _id: convId }, { $set: update });
    return await ChatService.populateConversation(convId);
  }, ChatSchemas.UpdateGroup)

  // ─── ADD GROUP MEMBER ─────────────────────────────────────────────────────
  .post('/groups/:conversationId/members', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    const newMemberId = oid(body.employeeId);
    if (!empId || !convId || !newMemberId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId });
    if (!conv || conv.type !== 'group') { set.status = 404; return { message: 'Group not found' }; }
    if (!conv.admin || !conv.admin.equals(empId)) { set.status = 403; return { message: 'Only the group admin can add members' }; }
    if ((conv.participants || []).some(p => p.equals(newMemberId))) {
      set.status = 400; return { message: 'Employee is already a member' };
    }

    await collections.conversations().updateOne({ _id: convId }, {
      $push: {
        participants: newMemberId,
        readBy: { participant: newMemberId, lastReadAt: new Date() },
      } as any,
      $set: { updatedAt: new Date() },
    });

    const [adder, added] = await Promise.all([
      collections.employees().findOne({ _id: empId }, { projection: { name: 1 } }),
      collections.employees().findOne({ _id: newMemberId }, { projection: { name: 1 } }),
    ]);

    await collections.messages().insertOne({
      _id: new ObjectId(),
      conversation: convId,
      sender: empId,
      text: `${adder?.name} added ${added?.name} to the group`,
      type: 'system',
      readBy: [empId],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    wsEmit(`conv:${convId.toHexString()}`, 'group:memberAdded', { conversationId: convId, employeeId: newMemberId, addedBy: empId });
    return await ChatService.populateConversation(convId);
  }, ChatSchemas.AddMember)

  // ─── REMOVE GROUP MEMBER ──────────────────────────────────────────────────
  .delete('/groups/:conversationId/members/:employeeId', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const convId = oid(params.conversationId);
    const removeId = oid(params.employeeId);
    if (!empId || !convId || !removeId) { set.status = 400; return { message: 'Invalid params' }; }

    const conv = await collections.conversations().findOne({ _id: convId });
    if (!conv || conv.type !== 'group') { set.status = 404; return { message: 'Group not found' }; }

    const isAdmin = conv.admin?.equals(empId);
    const isSelf = removeId.equals(empId);
    if (!isAdmin && !isSelf) { set.status = 403; return { message: 'Only the group admin can remove members' }; }
    if (isAdmin && isSelf) { set.status = 400; return { message: 'Admin cannot remove themselves. Transfer admin first.' }; }

    await collections.conversations().updateOne({ _id: convId }, {
      $pull: {
        participants: removeId,
        readBy: { participant: removeId },
      } as any,
      $set: { updatedAt: new Date() },
    });

    const [remover, removed] = await Promise.all([
      collections.employees().findOne({ _id: empId }, { projection: { name: 1 } }),
      collections.employees().findOne({ _id: removeId }, { projection: { name: 1 } }),
    ]);
    const systemText = isSelf ? `${removed?.name} left the group` : `${remover?.name} removed ${removed?.name} from the group`;

    await collections.messages().insertOne({
      _id: new ObjectId(),
      conversation: convId,
      sender: empId,
      text: systemText,
      type: 'system',
      readBy: [empId],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    wsEmit(`conv:${convId.toHexString()}`, 'group:memberRemoved', { conversationId: convId, employeeId: removeId, removedBy: empId });
    return await ChatService.populateConversation(convId);
  })

  // ─── EDIT MESSAGE ─────────────────────────────────────────────────────────
  .put('/messages/:messageId', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const msgId = oid(params.messageId);
    if (!empId || !msgId) { set.status = 400; return { message: 'Invalid params' }; }

    const message = await collections.messages().findOne({ _id: msgId });
    if (!message) { set.status = 404; return { message: 'Message not found' }; }
    if (!message.sender.equals(empId)) { set.status = 403; return { message: 'You can only edit your own messages' }; }
    if (message.isDeleted) { set.status = 400; return { message: 'Cannot edit a deleted message' }; }
    if (message.createdAt && Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
      set.status = 403; return { message: 'Messages can only be edited within 1 hour of sending' };
    }

    await collections.messages().updateOne({ _id: msgId }, {
      $set: { text: body.text, isEdited: true, editedAt: new Date(), updatedAt: new Date() },
    });

    const populated = await ChatService.populateMessage(msgId);
    wsEmit(`conv:${message.conversation.toHexString()}`, 'message:edited', populated);
    return populated;
  }, ChatSchemas.EditMessage)

  // ─── DELETE MESSAGE ───────────────────────────────────────────────────────
  .delete('/messages/:messageId', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const msgId = oid(params.messageId);
    if (!empId || !msgId) { set.status = 400; return { message: 'Invalid params' }; }

    const message = await collections.messages().findOne({ _id: msgId });
    if (!message) { set.status = 404; return { message: 'Message not found' }; }
    if (!message.sender.equals(empId)) { set.status = 403; return { message: 'You can only delete your own messages' }; }
    if (message.createdAt && Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
      set.status = 403; return { message: 'Messages can only be deleted within 1 hour of sending' };
    }

    await collections.messages().updateOne({ _id: msgId }, {
      $set: { isDeleted: true, text: '', deletedAt: new Date(), updatedAt: new Date() },
    });

    wsEmit(`conv:${message.conversation.toHexString()}`, 'message:deleted', { messageId: msgId, conversationId: message.conversation });
    return { message: 'Message deleted' };
  })

  // ─── ADD/TOGGLE REACTION ──────────────────────────────────────────────────
  .post('/messages/:messageId/reactions', async ({ user, params, body, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const msgId = oid(params.messageId);
    if (!empId || !msgId) { set.status = 400; return { message: 'Invalid params' }; }

    const message = await collections.messages().findOne({ _id: msgId });
    if (!message) { set.status = 404; return { message: 'Message not found' }; }

    const reactions = message.reactions || [];
    const existingIdx = reactions.findIndex(r => r.by && r.by.equals(empId) && r.emoji === body.emoji);
    if (existingIdx !== -1) reactions.splice(existingIdx, 1);
    else reactions.push({ emoji: body.emoji, by: empId });

    await collections.messages().updateOne({ _id: msgId }, { $set: { reactions, updatedAt: new Date() } });

    const populated = await ChatService.populateMessage(msgId, { includeReactions: true });
    wsEmit(`conv:${message.conversation.toHexString()}`, 'message:reaction', { messageId: msgId, reactions: populated?.reactions });
    return populated;
  }, ChatSchemas.Reaction)

  // ─── PIN/UNPIN ────────────────────────────────────────────────────────────
  .put('/messages/:messageId/pin', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const msgId = oid(params.messageId);
    if (!empId || !msgId) { set.status = 400; return { message: 'Invalid params' }; }

    const message = await collections.messages().findOne({ _id: msgId });
    if (!message) { set.status = 404; return { message: 'Message not found' }; }
    const conv = await collections.conversations().findOne({ _id: message.conversation, participants: empId } as any);
    if (!conv) { set.status = 403; return { message: 'Not a participant' }; }

    const newPinned = !message.isPinned;
    const update: any = { isPinned: newPinned, updatedAt: new Date() };
    const unset: any = {};
    if (newPinned) { update.pinnedBy = empId; update.pinnedAt = new Date(); }
    else { unset.pinnedBy = ''; unset.pinnedAt = ''; }

    const op: any = { $set: update };
    if (Object.keys(unset).length) op.$unset = unset;
    await collections.messages().updateOne({ _id: msgId }, op);

    const populated = await ChatService.populateMessage(msgId, { includePinnedBy: true });
    wsEmit(`conv:${message.conversation.toHexString()}`, 'message:pinned', { messageId: msgId, isPinned: newPinned });
    return populated;
  })

  // ─── STAR/UNSTAR ──────────────────────────────────────────────────────────
  .put('/messages/:messageId/star', async ({ user, params, set }) => {
    if (!user) { set.status = 401; return { message: 'Unauthorized' }; }
    const empId = user.employeeId ? oid(user.employeeId) : null;
    const msgId = oid(params.messageId);
    if (!empId || !msgId) { set.status = 400; return { message: 'Invalid params' }; }

    const message = await collections.messages().findOne({ _id: msgId });
    if (!message) { set.status = 404; return { message: 'Message not found' }; }
    const conv = await collections.conversations().findOne({ _id: message.conversation, participants: empId } as any);
    if (!conv) { set.status = 403; return { message: 'Not a participant' }; }

    const starred = (message.starredBy || []).some(id => id.equals(empId));
    if (starred) {
      await collections.messages().updateOne({ _id: msgId }, { $pull: { starredBy: empId } as any });
    } else {
      await collections.messages().updateOne({ _id: msgId }, { $addToSet: { starredBy: empId } as any });
    }

    return { messageId: msgId, isStarred: !starred };
  }));
