import { t } from 'elysia';

export const ChatSchemas = {
  Direct: {
    body: t.Object({ participantId: t.String() }),
  },
  CreateGroup: {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
      participants: t.Optional(t.Array(t.String())),
    }),
  },
  ListMessages: {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      /** ISO 8601 timestamp — return only messages created after this point.
       *  Used for offline recovery on WS reconnect (see WS-PROTOCOL.md §Missed Events). */
      since: t.Optional(t.String()),
    }),
  },
  SendMessage: {
    body: t.Object({
      text: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('text'), t.Literal('file'), t.Literal('image'), t.Literal('system')])),
      replyTo: t.Optional(t.String()),
      file: t.Optional(t.Object({
        fileName: t.Optional(t.String()),
        fileUrl: t.Optional(t.String()),
        fileSize: t.Optional(t.Number()),
        mimeType: t.Optional(t.String()),
      })),
    }),
  },
  EditMessage: {
    body: t.Object({ text: t.String({ minLength: 1 }) }),
  },
  Reaction: {
    body: t.Object({ emoji: t.String({ minLength: 1 }) }),
  },
  UpdateGroup: {
    body: t.Partial(t.Object({
      name: t.String(),
      description: t.String(),
    })),
  },
  AddMember: {
    body: t.Object({ employeeId: t.String() }),
  },
  Search: {
    query: t.Object({
      q: t.String({ minLength: 1 }),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  },
  ConversationMedia: {
    query: t.Object({
      type: t.Optional(t.Union([t.Literal('image'), t.Literal('file'), t.Literal('link')])),
    }),
  },
  UploadFile: {
    body: t.Object({ file: t.File({ maxSize: '25m' }) }),
  },
};
